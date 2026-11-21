/**
 * On-device language model via Chrome's built-in Prompt API (Gemini Nano).
 * Nothing leaves the browser: no API key, no server, no student data uploaded.
 * Everything the model is told has already been verified by the symbolic engine,
 * so its job is wording and questioning, never marking.
 */
import type { Step } from './engine/analyze'
import { CATALOG, explain } from './engine/catalog'
import { lineToText } from './engine/line'

/* eslint-disable @typescript-eslint/no-explicit-any */
declare global {
  interface Window {
    LanguageModel?: any
  }
}

export type AiStatus = 'checking' | 'ready' | 'downloadable' | 'downloading' | 'unavailable'

const OPTIONS = {
  expectedInputs: [{ type: 'text', languages: ['en'] }],
  expectedOutputs: [{ type: 'text', languages: ['en'] }],
}

export async function aiStatus(): Promise<AiStatus> {
  const LM = window.LanguageModel
  if (!LM) return 'unavailable'
  try {
    const a: string = await LM.availability(OPTIONS)
    if (a === 'available') return 'ready'
    if (a === 'downloadable' || a === 'downloading') return a
    return 'unavailable'
  } catch {
    return 'unavailable'
  }
}

const SYSTEM = `You are Faultline, a patient maths tutor for school and first-year university students.
A symbolic checker has already found the exact line where the student's working went wrong and why. Its FACTS are always correct: never contradict them and never re-mark the work yourself.
Rules:
- Speak to the student directly as "you". Be warm, specific and brief: at most 70 words.
- Refer to the student's own numbers and expressions.
- Explain WHY the wrong idea is tempting and why it fails. Do not just restate the rule.
- Never give the final answer to the problem and never write out the lines after the corrected step.
- Write maths in plain text like 2(x + 3) or x^2. No LaTeX, no markdown, no bullet points.
- End with one short question that makes the student think about the idea.`

export interface Tutor {
  /** Streams a reply. `onText` receives the full text so far. */
  say(prompt: string, onText: (text: string) => void, signal?: AbortSignal): Promise<string>
  destroy(): void
}

let base: Promise<any> | null = null

function baseSession(onDownload?: (fraction: number) => void): Promise<any> {
  const LM = window.LanguageModel
  if (!LM) return Promise.reject(new Error('No on-device model in this browser'))
  base ??= LM.create({
    ...OPTIONS,
    initialPrompts: [{ role: 'system', content: SYSTEM }],
    monitor(m: any) {
      m.addEventListener('downloadprogress', (e: any) => onDownload?.(e.loaded))
    },
  }).catch((e: unknown) => {
    base = null
    throw e
  })
  return base!
}

/** Loads the model ahead of the first mistake so the tutor answers without a cold start. */
export function warmTutor(): void {
  void baseSession().catch(() => {})
}

export async function createTutor(onDownload?: (fraction: number) => void): Promise<Tutor> {
  // Each conversation is a clone of one warmed-up session that already holds the system prompt.
  const session = await (await baseSession(onDownload)).clone()
  return {
    async say(prompt, onText, signal) {
      const stream = session.promptStreaming(prompt, { signal })
      let text = ''
      let previous = ''
      for await (const chunk of stream) {
        // Older builds stream the whole text so far, newer ones stream deltas. Handle both.
        text = previous && chunk.startsWith(previous) ? chunk : text + chunk
        previous = chunk
        onText(clean(text))
      }
      return clean(text)
    },
    destroy: () => session.destroy(),
  }
}

const clean = (s: string) => s.replace(/\*+([^*\n]+)\*+/g, '$1').replace(/\$/g, '').trim()

/** Turns the engine's TeX fragments into plain text a small model reads reliably. */
function plain(s: string): string {
  return s
    .replace(/\$/g, '')
    .replace(/\\left|\\right/g, '')
    .replace(/\\frac\{([^{}]*)\}\{([^{}]*)\}/g, '($1)/($2)')
    .replace(/\\sqrt\{([^{}]*)\}/g, 'sqrt($1)')
    .replace(/\\cdot/g, '*')
    .replace(/\\text\{([^{}]*)\}/g, '$1')
    .replace(/\\ /g, ' ')
    .replace(/\^\{([^{}]*)\}/g, '^$1')
    .replace(/[{}]/g, '')
    .replace(/\s+/g, ' ')
}

/** The verified facts about a fault, written out for the model. */
export function faultPrompt(steps: Step[], faultIndex: number): string {
  const fault = steps[faultIndex]
  const readable = steps.filter((s) => s.line)
  const prev = readable.filter((s) => s.index < fault.index && (s.status === 'ok' || s.status === 'start')).pop()
  const d = fault.diagnosis!
  const info = CATALOG[d.id]
  const cx = fault.counterexample
  const facts = [
    `The problem starts with: ${lineToText(readable[0].line!)}`,
    `Last correct line: ${prev?.line ? lineToText(prev.line) : '(the first line)'}`,
    `The student's next line, which is WRONG: ${lineToText(fault.line!)}`,
    `Diagnosed misconception: ${info.name}. The wrong idea: ${info.belief}`,
    `The rule that was broken: ${info.principle}`,
    `In detail: ${plain(explain(d, false))}`,
  ]
  if (cx) {
    const at = Object.entries(cx.at)
      .map(([k, v]) => `${k} = ${v}`)
      .join(', ')
    facts.push(`Number check: with ${at}, ${cx.prevSays}, but ${cx.curSays}.`)
  }
  if (d.id === 'unknown') facts.push('The checker could not name the mistake. Suggest the most likely misunderstanding, clearly marked as a guess.')
  return `FACTS\n${facts.map((f) => `- ${f}`).join('\n')}\n\nExplain this mistake to the student.`
}
