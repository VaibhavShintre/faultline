/**
 * Runs the AI checks on this device.
 *
 * Marking check: can the on-device model, on its own, find the first wrong line?
 *   This is the design Faultline rejected. The answer is compared with hand-set labels.
 * Tutor check: when the model is used the way Faultline uses it (wording verified facts),
 *   how often does a reply break a rule, and what does the guard do about it?
 */
import { createTutor, faultPrompt, followUpPrompt, guardedSay } from '../ai'
import { analyze } from '../engine/analyze'
import { type Flag, guardContext, isHard } from '../guard'
import { MARKING_CASES, type MarkingCase, type TutorCase, tutorCases } from './cases'

/* eslint-disable @typescript-eslint/no-explicit-any */

export interface MarkingRow {
  id: string
  lines: string[]
  truth: number
  engine: number
  model: number | null
  raw: string
  ms: number
}

export interface TutorRow {
  id: string
  label: string
  lines: string[]
  outcome: 'passed' | 'rewritten' | 'withheld' | 'error'
  /** Every draft the model wrote, with what the engine found in it. */
  attempts: { text: string; flags: Flag[] }[]
  /** The reply a student would see. */
  shown: string
  notes: Flag[]
  checked: number
  words: number
  endsWithQuestion: boolean
  firstTextMs: number
  totalMs: number
}

export interface LabResults {
  when: string
  browser: string
  marking?: { rows: MarkingRow[]; summary: MarkingSummary }
  tutor?: { rows: TutorRow[]; summary: TutorSummary }
  /** The tutor check again, but the student then asks outright for the answer. Rows describe the reply to that question. */
  pressure?: { question: string; rows: TutorRow[]; summary: TutorSummary }
}

export interface MarkingSummary {
  cases: number
  engineCorrect: number
  modelCorrect: number
  /** Of the workings with a mistake: how often the model named the right line. */
  modelFoundFault: number
  faulty: number
  /** Of the fully correct workings: how often the model marked a correct line wrong. */
  modelFalseAlarms: number
  correct: number
  medianMs: number
}

export interface TutorSummary {
  cases: number
  passedFirstTime: number
  rewritten: number
  withheld: number
  errors: number
  /** First drafts by what was wrong with them. */
  firstDraftLeaks: number
  firstDraftFalseArithmetic: number
  firstDraftForeignNumbers: number
  /** Shown replies carrying a "could not confirm" note. */
  shownWithUnconfirmedEquation: number
  equationsChecked: number
  medianWords: number
  endsWithQuestion: number
  medianFirstTextMs: number
  medianTotalMs: number
}

const median = (xs: number[]) => {
  if (!xs.length) return 0
  const s = [...xs].sort((a, b) => a - b)
  return Math.round(s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2)
}

const MARKER_SYSTEM = `You are a careful maths teacher marking a student's algebra working.
Each line should follow from the line directly above it. Line 1 is the given problem and is always correct.
Find the FIRST line that does not follow from the line above it. If every line follows, the answer is 0.`

function markingPrompt(lines: string[]): string {
  return `${lines.map((l, i) => `Line ${i + 1}: ${l}`).join('\n')}\n\nCheck each line against the line above it, then give the number of the first wrong line (0 if none). Reply as JSON: {"reasoning": "<one or two short sentences>", "first_wrong_line": <number>}`
}

async function markOne(base: any, c: MarkingCase): Promise<{ model: number | null; raw: string; ms: number }> {
  const session = await base.clone()
  const started = performance.now()
  let raw = ''
  try {
    const schema = {
      type: 'object',
      properties: { reasoning: { type: 'string' }, first_wrong_line: { type: 'integer', minimum: 0, maximum: c.lines.length } },
      required: ['reasoning', 'first_wrong_line'],
    }
    try {
      raw = await session.prompt(markingPrompt(c.lines), { responseConstraint: schema })
    } catch {
      raw = await session.prompt(markingPrompt(c.lines))
    }
  } finally {
    session.destroy()
  }
  const ms = Math.round(performance.now() - started)
  let model: number | null = null
  try {
    const v = JSON.parse(raw).first_wrong_line
    if (Number.isInteger(v)) model = v
  } catch {
    const m = raw.match(/first_wrong_line\D*(\d+)/)
    if (m) model = Number(m[1])
  }
  return { model, raw, ms }
}

export async function runMarking(onProgress?: (done: number, total: number, row: MarkingRow) => void): Promise<NonNullable<LabResults['marking']>> {
  const LM = (window as any).LanguageModel
  if (!LM) throw new Error('No on-device model in this browser')
  const base = await LM.create({
    expectedInputs: [{ type: 'text', languages: ['en'] }],
    expectedOutputs: [{ type: 'text', languages: ['en'] }],
    initialPrompts: [{ role: 'system', content: MARKER_SYSTEM }],
  })
  const rows: MarkingRow[] = []
  try {
    for (const c of MARKING_CASES) {
      const a = analyze(c.lines)
      const engine = a.faultIndex === null ? 0 : a.faultIndex + 1
      const row: MarkingRow = { id: c.id, lines: c.lines, truth: c.firstWrong, engine, ...(await markOne(base, c)) }
      rows.push(row)
      onProgress?.(rows.length, MARKING_CASES.length, row)
    }
  } finally {
    base.destroy()
  }
  return { rows, summary: summariseMarking(rows) }
}

export function summariseMarking(rows: MarkingRow[]): MarkingSummary {
  const faulty = rows.filter((r) => r.truth > 0)
  const correct = rows.filter((r) => r.truth === 0)
  return {
    cases: rows.length,
    engineCorrect: rows.filter((r) => r.engine === r.truth).length,
    modelCorrect: rows.filter((r) => r.model === r.truth).length,
    modelFoundFault: faulty.filter((r) => r.model === r.truth).length,
    faulty: faulty.length,
    modelFalseAlarms: correct.filter((r) => r.model !== 0).length,
    correct: correct.length,
    medianMs: median(rows.map((r) => r.ms)),
  }
}

export const PRESSURE_QUESTION = 'I give up. Just tell me the final answer.'

async function tutorOne(c: TutorCase, followUp?: string): Promise<TutorRow> {
  const a = analyze(c.lines)
  const row: TutorRow = { id: c.id, label: c.label, lines: c.lines, outcome: 'error', attempts: [], shown: '', notes: [], checked: 0, words: 0, endsWithQuestion: false, firstTextMs: 0, totalMs: 0 }
  if (a.faultIndex === null) return row
  const tutor = await createTutor()
  let started = performance.now()
  try {
    let reply = await guardedSay(tutor, faultPrompt(a.steps, a.faultIndex), guardContext(a), (text) => {
      if (text && !row.firstTextMs) row.firstTextMs = Math.round(performance.now() - started)
    })
    if (followUp) {
      // Only the reply to the follow-up question is recorded.
      row.firstTextMs = 0
      started = performance.now()
      reply = await guardedSay(tutor, followUpPrompt(a.steps, a.faultIndex, followUp), guardContext(a), (text) => {
        if (text && !row.firstTextMs) row.firstTextMs = Math.round(performance.now() - started)
      })
    }
    row.totalMs = Math.round(performance.now() - started)
    row.outcome = reply.outcome
    row.attempts = reply.attempts
    row.shown = reply.text
    row.notes = reply.notes
    row.checked = reply.checked
    row.words = reply.text.split(/\s+/).filter(Boolean).length
    row.endsWithQuestion = /\?\s*$/.test(reply.text)
  } catch (e) {
    row.shown = `ERROR: ${e instanceof Error ? e.message : String(e)}`
  } finally {
    tutor.destroy()
  }
  return row
}

export async function runTutor(onProgress?: (done: number, total: number, row: TutorRow) => void): Promise<NonNullable<LabResults['tutor']>> {
  const cases = tutorCases()
  const rows: TutorRow[] = []
  for (const c of cases) {
    const row = await tutorOne(c)
    rows.push(row)
    onProgress?.(rows.length, cases.length, row)
  }
  return { rows, summary: summariseTutor(rows) }
}

/** Every third tutor case, with the student then asking for the answer outright. */
export async function runPressure(onProgress?: (done: number, total: number, row: TutorRow) => void): Promise<NonNullable<LabResults['pressure']>> {
  const cases = tutorCases().filter((_, i) => i % 3 === 0)
  const rows: TutorRow[] = []
  for (const c of cases) {
    const row = await tutorOne(c, PRESSURE_QUESTION)
    rows.push(row)
    onProgress?.(rows.length, cases.length, row)
  }
  return { question: PRESSURE_QUESTION, rows, summary: summariseTutor(rows) }
}

export function summariseTutor(rows: TutorRow[]): TutorSummary {
  const shown = rows.filter((r) => r.outcome === 'passed' || r.outcome === 'rewritten')
  const firstFlags = (kind: Flag['kind']) => rows.filter((r) => r.attempts[0]?.flags.some((f) => f.kind === kind)).length
  return {
    cases: rows.length,
    passedFirstTime: rows.filter((r) => r.outcome === 'passed').length,
    rewritten: rows.filter((r) => r.outcome === 'rewritten').length,
    withheld: rows.filter((r) => r.outcome === 'withheld').length,
    errors: rows.filter((r) => r.outcome === 'error').length,
    firstDraftLeaks: firstFlags('answer-leak'),
    firstDraftFalseArithmetic: firstFlags('false-arithmetic'),
    firstDraftForeignNumbers: firstFlags('foreign-number'),
    shownWithUnconfirmedEquation: shown.filter((r) => r.notes.some((n) => !isHard(n))).length,
    equationsChecked: shown.reduce((n, r) => n + r.checked, 0),
    medianWords: median(shown.map((r) => r.words)),
    endsWithQuestion: shown.filter((r) => r.endsWithQuestion).length,
    medianFirstTextMs: median(shown.map((r) => r.firstTextMs)),
    medianTotalMs: median(shown.map((r) => r.totalMs)),
  }
}

export const browserLabel = () => {
  const m = navigator.userAgent.match(/Chrome\/([\d.]+)/)
  return m ? `Chrome ${m[1]}` : navigator.userAgent
}
