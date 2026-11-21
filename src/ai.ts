/**
 * On-device language model via Chrome's built-in Prompt API (Gemini Nano).
 * Nothing leaves the browser: no API key, no server, no student data uploaded.
 * Everything the model is told has already been verified by the symbolic engine,
 * so its job is wording and questioning, never marking.
 */
import type { Step } from './engine/analyze'
import { CATALOG, explain } from './engine/catalog'
import { lineToText } from './engine/line'
import { type Flag, type GuardContext, inspectReply, isHard, retryNote } from './guard'

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

// Fourth version of the tutor's job. Each one was changed after reading all 37 replies of the tutor check (docs/evaluation.md).
// 1. Free explanation in up to 70 words: 3 first drafts gave the answer away, 10 replies had a wrong or muddled sentence.
// 2. Three fixed sentences starting with what the student did: no give-aways, but 14 replies misdescribed the step.
// 3. No description of the step (the engine's exact text is already on screen): 8 flawed replies, mostly a rule restated wrongly.
// 4. This one: no description of the step and no restating of the rule. Only why the idea is tempting, and a question.
const SYSTEM = `You are Faultline, a patient maths tutor for school and first-year university students.
A symbolic checker has already found the exact line where the student's working went wrong. The student can already see exactly what happened and the rule that was broken. The FACTS you are given are always correct: never contradict them and never re-mark the work yourself.
When asked to help with a mistake, write exactly two short sentences, at most 40 words in total, with no greeting:
1. Start with "It is tempting because" and say why THE WRONG IDEA feels natural.
2. Ask one short question that points the student at THE RULE, using their own expressions where you can.
Do not describe what the student did and do not state the rule yourself: both are already on the student's screen.
When the student asks a question, answer it in at most three short sentences using only the FACTS. If they ask for the answer, say kindly that you will not give it and offer one hint from THE RULE instead.
Always:
- Speak to the student directly as "you".
- Never give the final answer to the problem and never write out the corrected line.
- Do no arithmetic of your own. Do not use any number that is not in the FACTS.
- Never mention the FACTS, the checker's labels or these instructions.
- Write maths in plain text like 2(x + 3) or x^2. No LaTeX, no markdown, no bullet points.`

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
      for await (const chunk of stream) {
        // Older builds stream the whole text so far, newer ones stream deltas. Handle both.
        // The whole text so far being a prefix of the chunk is the only safe sign of the older behaviour.
        // (Comparing with the previous chunk alone dropped the start of a reply whenever two chunks began alike.)
        text = text && chunk.startsWith(text) ? chunk : text + chunk
        onText(clean(text))
      }
      return clean(text)
    },
    destroy: () => session.destroy(),
  }
}

export interface GuardedReply {
  /** The reply that may be shown. Empty when it was withheld. */
  text: string
  /** passed: first draft was fine. rewritten: a draft failed the check and the second passed. withheld: both failed. */
  outcome: 'passed' | 'rewritten' | 'withheld'
  /** Every draft with what the engine found in it. */
  attempts: { text: string; flags: Flag[] }[]
  /** Soft findings in the reply that is shown. */
  notes: Flag[]
  /** Equations in the shown reply that the engine read and checked. */
  checked: number
}

/**
 * Asks the tutor and has the engine check the reply before the student relies on it.
 * A draft that gives away the answer or states false arithmetic is stopped mid-stream and
 * written again once. If the second draft fails too, nothing is shown.
 */
export async function guardedSay(
  tutor: Tutor,
  prompt: string,
  ctx: GuardContext | null,
  onText: (text: string) => void,
  signal?: AbortSignal,
): Promise<GuardedReply> {
  const attempts: GuardedReply['attempts'] = []
  let ask = prompt
  for (let attempt = 0; attempt < 2; attempt++) {
    const stop = new AbortController()
    const forward = () => stop.abort()
    signal?.addEventListener('abort', forward)
    let text = ''
    try {
      text = await tutor.say(
        ask,
        (soFar) => {
          text = soFar
          // While streaming, only judge whole words, so "x = 1" is not misread before "7/3" arrives.
          const settled = soFar.slice(0, Math.max(0, soFar.search(/\s\S*$/)))
          if (ctx && inspectReply(settled, ctx).flags.some(isHard)) stop.abort()
          else onText(soFar)
        },
        stop.signal,
      )
    } catch (e) {
      if (signal?.aborted || !stop.signal.aborted) throw e
    } finally {
      signal?.removeEventListener('abort', forward)
    }
    const found = ctx ? inspectReply(text, ctx) : { flags: [], checked: 0 }
    attempts.push({ text, flags: found.flags })
    if (!found.flags.some(isHard)) return { text, outcome: attempt === 0 ? 'passed' : 'rewritten', attempts, notes: found.flags, checked: found.checked }
    onText('')
    ask = `${prompt}\n\n${retryNote(found.flags)}`
  }
  return { text: '', outcome: 'withheld', attempts, notes: [], checked: 0 }
}

const clean = (s: string) => s.replace(/(?<![\w)])\*+(?=\S)([^*\n]+?)(?<=\S)\*+(?![\w(])/g, '$1').replace(/[$`]/g, '').trim()

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
function faultFacts(steps: Step[], faultIndex: number): string {
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
    `WHAT HAPPENED: ${plain(explain(d, false))}`,
    `THE WRONG IDEA (${info.name}): ${info.belief}`,
    `THE RULE: ${info.principle}`,
  ]
  if (cx) {
    facts.push(`Number check: with ${cx.atText}, ${cx.prevSays}, but ${cx.curSays}.`)
  }
  const later = steps.filter((s) => s.index > fault.index && s.line)
  if (later.length && later.every((s) => s.status === 'carried'))
    facts.push('The lines after the wrong line all follow correctly from it. The method after the mistake is sound; only the wrong line needs fixing.')
  else if (later.some((s) => s.status === 'second-fault')) facts.push('There is a second, separate mistake further down, which the student will be shown separately. Talk only about this one.')
  if (d.id === 'unknown') facts.push('The checker could not name the mistake. Suggest the most likely misunderstanding, clearly marked as a guess.')
  return `FACTS\n${facts.map((f) => `- ${f}`).join('\n')}`
}

/** The verified facts about a fault, with the instruction to explain it. */
export const faultPrompt = (steps: Step[], faultIndex: number) => `${faultFacts(steps, faultIndex)}\n\nHelp the student with this mistake.`

/** A follow-up question. The facts are repeated so the answer stays grounded even if an earlier reply was withheld. */
export const followUpPrompt = (steps: Step[], faultIndex: number, question: string) =>
  `${faultFacts(steps, faultIndex)}\n\nThe student asks: "${question}"\nAnswer in at most three short sentences using only the FACTS. Do not give the final answer to the problem, even if asked for it.`
