import { analyze } from './analyze'
import { termsOf } from './ast'
import type { Line } from './line'
import type { MisconceptionId } from './malrules'
import { pretty } from './malrules'

export interface Problem {
  skill: MisconceptionId
  task: 'solve' | 'simplify'
  /** First line of the working, given to the student. */
  start: string
  /** The tempting wrong next line this problem is built to provoke. Never shown; used to self-test the generator. */
  trap: string
}

export type Rng = () => number

/** Small seeded generator so tests are repeatable. */
export function seeded(seed: number): Rng {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const int = (r: Rng, lo: number, hi: number) => lo + Math.floor(r() * (hi - lo + 1))
const pick = <T>(r: Rng, xs: T[]) => xs[int(r, 0, xs.length - 1)]

type Gen = (r: Rng) => Omit<Problem, 'skill'>

const linear: Gen = (r) => {
  const [a, b, c, x] = [int(r, 2, 5), int(r, 1, 6), int(r, 1, 9), int(r, 2, 9)]
  return { task: 'solve', start: `${a}(x - ${b}) + ${c} = ${a * (x - b) + c}`, trap: `${a}x - ${b} + ${c} = ${a * (x - b) + c}` }
}

const GENERATORS: Partial<Record<MisconceptionId, Gen>> = {
  'distribute-partial': (r) => {
    const [a, b, x] = [int(r, 2, 6), int(r, 1, 9), int(r, 1, 9)]
    return { task: 'solve', start: `${a}(x + ${b}) = ${a * (x + b)}`, trap: `${a}x + ${b} = ${a * (x + b)}` }
  },
  'negative-distribution': (r) => {
    const [c, b, x] = [int(r, 8, 15), int(r, 1, 6), int(r, 1, 7)]
    return { task: 'solve', start: `${c} - (x - ${b}) = ${c - x + b}`, trap: `${c} - x - ${b} = ${c - x + b}` }
  },
  'power-over-sum': (r) => {
    const a = int(r, 2, 7)
    return pick(r, [
      { task: 'simplify' as const, start: `(x + ${a})^2`, trap: `x^2 + ${a * a}` },
      { task: 'simplify' as const, start: `(x - ${a})^2`, trap: `x^2 - ${a * a}` },
    ])
  },
  'exponent-rules': (r) => {
    const [a, b] = pick(r, [[2, 3], [3, 4], [2, 5], [3, 5], [4, 5], [2, 4]])
    return pick(r, [
      { task: 'simplify' as const, start: `x^${a} * x^${b}`, trap: `x^${a * b}` },
      { task: 'simplify' as const, start: `(x^${a})^${b}`, trap: `x^${a + b}` },
    ])
  },
  'unlike-terms': (r) => {
    const [a, b, x] = [int(r, 2, 5), int(r, 1, 8), int(r, 1, 8)]
    return { task: 'solve', start: `${a}x + ${b} = ${a * x + b}`, trap: `${a + b}x = ${a * x + b}` }
  },
  'fraction-add': (r) => {
    const [a, b] = pick(r, [[2, 3], [3, 4], [2, 5], [3, 5], [4, 5], [2, 7]])
    return { task: 'simplify', start: `1/${a} + 1/${b}`, trap: `2/${a + b}` }
  },
  'cancel-across-sum': (r) => {
    const [a, k] = [int(r, 2, 5), int(r, 2, 6)]
    return { task: 'simplify', start: `(${a}x + ${a * k})/${a}`, trap: `x + ${a * k}` }
  },
  'move-sign': (r) => {
    const [a, b, x] = [int(r, 2, 6), int(r, 2, 9), int(r, 2, 9)]
    return { task: 'solve', start: `${a}x + ${b} = ${a * x + b}`, trap: `${a}x = ${a * x + b + b}` }
  },
  'divide-every-term': (r) => {
    const [a, k, x] = [int(r, 2, 5), int(r, 1, 5), int(r, 1, 8)]
    return { task: 'solve', start: `${a}x + ${a * k} = ${a * (x + k)}`, trap: `x + ${a * k} = ${x + k}` }
  },
  'multiply-every-term': (r) => {
    const [a, b, k] = [int(r, 2, 5), int(r, 1, 6), int(r, 1, 6)]
    return { task: 'solve', start: `x/${a} + ${b} = ${k + b}`, trap: `x + ${b} = ${a * (k + b)}` }
  },
  'inverse-operation': (r) => {
    const [a, x] = [int(r, 3, 9), int(r, 2, 9)]
    return { task: 'solve', start: `${a}x = ${a * x}`, trap: `x = ${a * x - a}` }
  },
  'zero-product': (r) => {
    // (x - a)(x - b) = c, built so the true solutions x = a + k and x = b - k are whole numbers
    const [a, b, k] = [int(r, 1, 4), int(r, 6, 9), pick(r, [-2, -1, 1, 2])]
    const c = k * (a + k - b)
    return { task: 'solve', start: `(x - ${a})(x - ${b}) = ${c}`, trap: `x - ${a} = ${c} or x - ${b} = ${c}` }
  },
  'forgot-plus-minus': (r) => {
    const n = int(r, 2, 12)
    return { task: 'solve', start: `x^2 = ${n * n}`, trap: `x = ${n}` }
  },
  'root-sign': (r) => {
    const [a, b] = [int(r, 1, 9), int(r, 1, 9)]
    return { task: 'solve', start: `(x - ${a})(x + ${b}) = 0`, trap: `x = -${a} or x = ${b}` }
  },
  'lost-solution': (r) => {
    const a = int(r, 2, 9)
    return { task: 'solve', start: `x^2 = ${a}x`, trap: `x = ${a}` }
  },
}

export function makeProblem(skill: MisconceptionId, r: Rng = Math.random): Problem {
  const gen = GENERATORS[skill]
  if (!gen) return { skill, ...linear(r) }
  // Random numbers sometimes line up so the trap is correct or looks like a different mistake.
  // Keep drawing until the engine itself confirms the trap is this misconception.
  for (let attempt = 0; attempt < 40; attempt++) {
    const p = gen(r)
    const a = analyze([p.start, p.trap])
    if (a.faultIndex !== null && a.steps[a.faultIndex].diagnosis?.id === skill) return { skill, ...p }
  }
  return { skill, ...gen(r) }
}

export const hasTargetedPractice = (skill: MisconceptionId) => skill in GENERATORS

/** Has the student actually finished, not just written a true line? */
export function isFinished(task: Problem['task'], last: Line): boolean {
  if (task === 'solve') {
    if (last.kind !== 'eq') return false
    return last.parts.every((p) => p.lhs.t === 'var' && !JSON.stringify(p.rhs, (_, v) => (typeof v === 'bigint' ? `${v}` : v)).includes('"var"'))
  }
  if (last.kind !== 'expr') return false
  const node = last.node
  const hasBracketedSum = (n: typeof node): boolean => {
    if (n.t === 'mul') return n.a.some((c) => c.t === 'add' || hasBracketedSum(c))
    if (n.t === 'pow') return n.b.t === 'add' || n.b.t === 'pow' || hasBracketedSum(n.b)
    if (n.t === 'div') return (n.n.t === 'add' && n.d.t !== 'num') || hasBracketedSum(n.n)
    if (n.t === 'add') return n.a.some(hasBracketedSum)
    if (n.t === 'neg') return n.x.t === 'add' || hasBracketedSum(n.x)
    return false
  }
  if (hasBracketedSum(node)) return false
  return termsOf(node).length === termsOf(pretty(node)).length
}
