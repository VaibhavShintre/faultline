/**
 * Checks the tutor's own words.
 *
 * The on-device model is told verified facts and asked only to word them, but a small
 * model can still do arithmetic of its own or blurt out the answer. This module reads
 * every piece of maths in a reply and has the symbolic engine check it:
 *
 *   answer-leak          the reply states a solution of the problem (or the fully simplified
 *                        answer) that the student has not written and the app has not shown
 *   false-arithmetic     the reply states a numeric equality that is false, or says two
 *                        equal things differ
 *   unverified-equation  the reply contains an equation that is neither a true identity,
 *                        nor equivalent to one of the student's lines, nor a quote of a step
 *
 * The first two are hard failures: the reply is retried and, if it fails again, withheld.
 * The third is reported but allowed, because prose can quote a wrong idea legitimately.
 */
import type { Analysis } from './engine/analyze'
import { type Node, ParseError, add, children, normalizeInput, parseExpr, variables } from './engine/ast'
import { type Line, exprLine, lineVariables, nice, sameExpression, sameLine, solutionsOf } from './engine/line'
import { evaluate } from './engine/poly'
import { isFinished } from './engine/practice'

export type FlagKind = 'answer-leak' | 'false-arithmetic' | 'unverified-equation'

export interface Flag {
  kind: FlagKind
  /** The piece of the reply that tripped the check, as the model wrote it. */
  quote: string
  /** One sentence for people. */
  detail: string
}

export interface GuardContext {
  /** The first line of the working: the problem itself. */
  problem: Line
  /** Every readable line the student wrote, in order. */
  lines: Line[]
  variables: Set<string>
  /** Real solutions of the problem, when it is an equation in one variable. */
  roots: number[]
  /** Values the student wrote as "x = ..." or that the number check already displays. */
  shown: number[]
  /** Numbers quoted in the number check, which the tutor may repeat even inside a false equality. */
  checkNumbers: number[]
  /** Sub-expressions of the student's lines, so that a quoted step is recognised. */
  fragments: Node[]
}

const near = (a: number, b: number) => Math.abs(a - b) <= 1e-6 * Math.max(1, Math.abs(a), Math.abs(b))
const has = (xs: number[], v: number) => xs.some((x) => near(x, v))

function constantValue(n: Node): number | null {
  if (variables(n).size) return null
  const v = evaluate(n, {})
  return Number.isFinite(v) ? v : null
}

/** Every sub-expression of a node, including runs of neighbouring terms in a sum. */
function fragmentsOf(n: Node, out: Node[] = []): Node[] {
  out.push(n)
  if (n.t === 'add')
    for (let i = 0; i < n.a.length; i++) for (let j = i + 2; j <= n.a.length; j++) if (j - i < n.a.length) out.push(add(...n.a.slice(i, j)))
  children(n).forEach((c) => fragmentsOf(c, out))
  return out
}

const sidesOf = (line: Line): Node[] => (line.kind === 'expr' ? [line.node] : line.parts.flatMap((p) => [p.lhs, p.rhs]))

export function guardContext(analysis: Analysis): GuardContext | null {
  const readable = analysis.steps.filter((s) => s.line)
  if (!readable.length) return null
  const lines = readable.map((s) => s.line!)
  const problem = lines[0]
  const vars = new Set(lines.flatMap(lineVariables))

  let roots: number[] = []
  if (problem.kind === 'eq') {
    const sol = solutionsOf(problem)
    if (sol.type === 'roots') roots = sol.roots.filter((z) => z[1] === 0).map((z) => z[0])
  }

  const shown: number[] = []
  for (const line of lines)
    if (line.kind === 'eq')
      for (const p of line.parts) {
        const v = p.lhs.t === 'var' ? constantValue(p.rhs) : p.rhs.t === 'var' ? constantValue(p.lhs) : null
        if (v !== null) shown.push(v)
      }
  const checkNumbers: number[] = []
  for (const s of analysis.steps) {
    const cx = s.counterexample
    if (!cx) continue
    shown.push(...Object.values(cx.at))
    for (const m of `${cx.prevSays} ${cx.curSays}`.matchAll(/-?\d+(?:\.\d+)?/g)) checkNumbers.push(Number(m[0]))
  }

  return { problem, lines, variables: vars, roots, shown, checkNumbers, fragments: lines.flatMap(sidesOf).flatMap((n) => fragmentsOf(n)) }
}

/* ------------------------------ Reading the reply ----------------------------- */

interface Relation {
  op: '=' | '≠'
  left: string
  right: string
}

const isLetter = (c: string | undefined) => !!c && /[a-zA-Z]/.test(c)

/** Maximal stretches of the text that are written in maths rather than words. */
export function mathRuns(text: string, vars: Set<string>): string[] {
  const s = normalizeInput(text).replace(/sqrt/g, '√')
  const mathy = (i: number): boolean => {
    const c = s[i]
    if (/[0-9+\-*/^().\s=≠√]/.test(c)) return true
    // A lone letter counts only when it is one of the problem's variables: "x", "3x", "x^2", but not "a" in "a bracket".
    return isLetter(c) && vars.has(c) && !isLetter(s[i - 1]) && !isLetter(s[i + 1])
  }
  const runs: string[] = []
  let cur = ''
  for (let i = 0; i <= s.length; i++) {
    if (i < s.length && mathy(i)) cur += s[i]
    else {
      if (/[0-9]/.test(cur) || [...vars].some((v) => cur.includes(v))) runs.push(cur)
      cur = ''
    }
  }
  return runs.map(tidy).filter(Boolean)
}

/** Strips the punctuation that prose leaves around a piece of maths. */
function tidy(run: string): string {
  let r = run.replace(/√/g, 'sqrt').trim()
  for (let pass = 0; pass < 6; pass++) {
    const before = r
    r = r.replace(/^[+*/^).=≠\s]+/, '').replace(/[+\-*/^(.=≠\s]+$/, '')
    // Drop brackets that were opened or closed by the sentence, not the maths.
    let depth = 0
    let minDepth = 0
    for (const c of r) {
      if (c === '(') depth++
      if (c === ')') depth--
      minDepth = Math.min(minDepth, depth)
    }
    if (minDepth < 0) r = r.replace(/\)(?=[^)]*$)/, '')
    else if (depth > 0) r = r.replace(/\(/, '')
    if (r === before) break
  }
  return r
}

function relationsIn(run: string): Relation[] {
  const parts = run.split(/([=≠])/)
  const out: Relation[] = []
  for (let i = 1; i < parts.length; i += 2) out.push({ op: parts[i] as '=' | '≠', left: tidy(parts[i - 1]), right: tidy(parts[i + 1]) })
  return out
}

function tryParse(src: string): Node | null {
  if (!src) return null
  try {
    return parseExpr(src)
  } catch (e) {
    if (e instanceof ParseError) return null
    throw e
  }
}

/* ---------------------------------- Checks ---------------------------------- */

const safe = <T>(f: () => T, fallback: T): T => {
  try {
    return f()
  } catch {
    return fallback
  }
}

const isFragment = (ctx: GuardContext, n: Node) => ctx.fragments.some((f) => safe(() => sameExpression(f, n), false))
const isAtom = (n: Node) => n.t === 'num' || n.t === 'var' || (n.t === 'neg' && (n.x.t === 'num' || n.x.t === 'var'))

/** "3(x - 2) = 3x - 2": both sides are pieces of what the student wrote, so this is a quote of their step. */
const isQuotedStep = (ctx: GuardContext, l: Node, r: Node) => !(isAtom(l) && isAtom(r)) && isFragment(ctx, l) && isFragment(ctx, r)

function leakOf(ctx: GuardContext, value: number): boolean {
  return has(ctx.roots, value) && !has(ctx.shown, value)
}

/** For "simplify" problems: is this expression the finished answer, which nobody has written yet? */
function isFinishedAnswer(ctx: GuardContext, n: Node): boolean {
  const problem = ctx.problem
  if (problem.kind !== 'expr') return false
  if (!safe(() => sameExpression(problem.node, n), false)) return false
  if (!safe(() => isFinished('simplify', exprLine(n)), false)) return false
  // If the student already reached the finished form, there is nothing left to give away.
  return !ctx.lines.some((l) => l.kind === 'expr' && safe(() => sameExpression(l.node, n) && isFinished('simplify', l), false))
}

export interface Inspection {
  flags: Flag[]
  /** How many equations and inequalities in the reply the engine was able to read and check. */
  checked: number
}

/** Reads a reply and returns everything in it that the engine cannot stand behind. */
export function inspectReply(text: string, ctx: GuardContext): Inspection {
  const flags: Flag[] = []
  let checked = 0
  const seen = new Set<string>()
  const flag = (kind: FlagKind, quote: string, detail: string) => {
    const key = `${kind}|${quote}`
    if (!seen.has(key)) {
      seen.add(key)
      flags.push({ kind, quote, detail })
    }
  }
  const leak = (quote: string, value: number) => flag('answer-leak', quote, `It gives away a solution of the problem (${nice(value)}).`)

  for (const run of mathRuns(text, ctx.variables)) {
    const relations = relationsIn(run)
    if (!relations.length) {
      const n = tryParse(run)
      if (n && !isAtom(n) && isFinishedAnswer(ctx, n)) flag('answer-leak', run, 'It gives away the fully simplified answer.')
      else if (n && isAtom(n) && ctx.problem.kind === 'expr' && !variables(ctx.problem.node).size && isFinishedAnswer(ctx, n))
        flag('answer-leak', run, 'It gives away the final value.')
      continue
    }
    for (const rel of relations) {
      const [l, r] = [tryParse(rel.left), tryParse(rel.right)]
      if (!l || !r) continue
      checked++
      const quote = `${rel.left} ${rel.op} ${rel.right}`
      const vars = variables(l, variables(r))

      if (rel.op === '≠') {
        if (safe(() => sameExpression(l, r), false)) flag('false-arithmetic', quote, 'It says two equal things are different.')
        continue
      }

      for (const side of [l, r]) if (isFinishedAnswer(ctx, side) && !isAtom(side)) flag('answer-leak', quote, 'It gives away the fully simplified answer.')

      if (vars.size === 0) {
        const [a, b] = [evaluate(l, {}), evaluate(r, {})]
        if (!Number.isFinite(a) || !Number.isFinite(b) || near(a, b)) continue
        if (has(ctx.checkNumbers, a) && has(ctx.checkNumbers, b)) continue // repeating the failed number check
        if (isQuotedStep(ctx, l, r)) continue
        flag('false-arithmetic', quote, `It states ${quote}, which is false.`)
        continue
      }

      // "x = 7" or "7 = x"
      const value = l.t === 'var' ? constantValue(r) : r.t === 'var' ? constantValue(l) : null
      if (value !== null) {
        if (leakOf(ctx, value)) leak(quote, value)
        continue
      }

      if (safe(() => sameExpression(l, r), false)) continue // a true identity
      const asLine: Line = { kind: 'eq', parts: [{ lhs: l, rhs: r }] }
      if (ctx.lines.some((line) => line.kind === 'eq' && safe(() => sameLine(line, asLine), false))) continue // restates a line of the working
      if (isQuotedStep(ctx, l, r)) continue
      flag('unverified-equation', quote, `The checker cannot confirm ${quote}.`)
    }
  }

  // Answers given in words: "x is 7", "the answer is 7".
  const number = String.raw`(-?\d+(?:\.\d+)?(?:\s*\/\s*\d+)?)`
  const verbs = String.raw`(?:is|equals|must be|should be|will be|would be|has to be|comes out as|comes to|works out as|works out to)`
  const patterns = [
    new RegExp(String.raw`(?<![a-zA-Z])([a-zA-Z])\s+${verbs}\s+${number}(?![\d(a-zA-Z^*])`, 'g'),
    new RegExp(String.raw`\b(answer|solution|result)\s+(?:${verbs}|=)\s+(?:[a-zA-Z]\s*=\s*)?${number}(?![\d(a-zA-Z^*])`, 'gi'),
  ]
  const normal = normalizeInput(text)
  patterns.forEach((re, which) => {
    for (const m of normal.matchAll(re)) {
      if (which === 0 && !ctx.variables.has(m[1])) continue
      const n = tryParse(m[2])
      const v = n && constantValue(n)
      if (v !== null && v !== undefined && leakOf(ctx, v)) leak(m[0], v)
    }
  })

  return { flags, checked }
}

export const isHard = (f: Flag) => f.kind === 'answer-leak' || f.kind === 'false-arithmetic'

/** What to add to the prompt when a reply has to be written again. */
export function retryNote(flags: Flag[]): string {
  const reasons = flags.filter(isHard).map((f) => (f.kind === 'answer-leak' ? `it gave away the answer ("${f.quote}")` : `it contained a false statement ("${f.quote}")`))
  return `IMPORTANT: an earlier attempt could not be shown to the student because ${reasons.join(' and ')}. This time do not state any solution of the problem and do not do any arithmetic of your own. Use only the FACTS.`
}
