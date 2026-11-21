import { type Node, ParseError, add, mul, neg, normalizeInput, parseExpr, sub, toTex, toText, variables } from './ast'
import { NonPolynomial, Poly, evaluate, toRatFn } from './poly'
import { ONE } from './rational'

export interface Equation {
  lhs: Node
  rhs: Node
}

/**
 * One line of a student's working: either a bare expression (simplifying)
 * or one or more equations joined by "or" (solving). "No solution" is an empty list.
 */
export type Line = { kind: 'expr'; node: Node } | { kind: 'eq'; parts: Equation[] }

export const eqLine = (...parts: Equation[]): Line => ({ kind: 'eq', parts })
export const exprLine = (node: Node): Line => ({ kind: 'expr', node })

/** Parses "2(x+3) = 10", "x = 3 or x = -2", "x = 2, -5", "x = ±3", "no solution", or an expression. */
export function parseLine(src: string): Line {
  const text = normalizeInput(src).trim()
  if (!text) throw new ParseError('Empty line')
  if (/^(no (real )?solutions?|none|∅)$/i.test(text)) return eqLine()
  if (!text.includes('=')) {
    if (text.includes('±')) throw new ParseError('± only makes sense in an equation')
    return exprLine(parseExpr(text))
  }

  const pieces = text
    .split(/\s+or\s+|\s+and\s+|[,;]/i)
    .map((s) => s.trim())
    .filter(Boolean)
  const parts: Equation[] = []
  let lastLhs: string | null = null
  for (const piece of pieces) {
    const sides = piece.split('=')
    if (sides.length > 2) throw new ParseError('Write one equals sign per equation')
    const l: string | null = sides.length === 2 ? sides[0] : lastLhs
    const r: string = sides.length === 2 ? sides[1] : sides[0]
    if (l === null) throw new ParseError(`"${piece}" is missing an equals sign`)
    lastLhs = l
    const variants = r.includes('±') ? [r.replace(/±/g, '+'), r.replace(/±/g, '-')] : [r]
    if (l.includes('±')) throw new ParseError('Put ± on the right-hand side')
    for (const v of variants) parts.push({ lhs: parseExpr(l), rhs: parseExpr(v) })
  }
  return eqLine(...parts)
}

export function lineToText(line: Line): string {
  if (line.kind === 'expr') return toText(line.node)
  if (line.parts.length === 0) return 'no solution'
  return line.parts.map((p) => `${toText(p.lhs)} = ${toText(p.rhs)}`).join(' or ')
}

export function lineToTex(line: Line): string {
  if (line.kind === 'expr') return toTex(line.node)
  if (line.parts.length === 0) return '\\text{no solution}'
  return line.parts.map((p) => `${toTex(p.lhs)} = ${toTex(p.rhs)}`).join('\\ \\text{ or }\\ ')
}

export function lineVariables(line: Line): string[] {
  const s = new Set<string>()
  if (line.kind === 'expr') variables(line.node, s)
  else
    for (const p of line.parts) {
      variables(p.lhs, s)
      variables(p.rhs, s)
    }
  return [...s].sort()
}

/* ------------------------------- Equivalence ------------------------------- */

/** Deterministic sample points so results never flicker between runs. */
const SAMPLES = [0.7310585786, -1.3862943611, 2.2360679775, -0.4142135624, 3.1415926536, -2.7182818285, 1.6180339887]

function sampleEnv(vars: string[], i: number): Record<string, number> {
  const env: Record<string, number> = {}
  vars.forEach((v, j) => (env[v] = SAMPLES[(i + j * 3) % SAMPLES.length] * (1 + 0.37 * j)))
  return env
}

const close = (a: number, b: number) => Math.abs(a - b) <= 1e-7 * Math.max(1, Math.abs(a), Math.abs(b))

/** Are two expressions equal for every value of their variables? */
export function sameExpression(a: Node, b: Node): boolean {
  try {
    const x = toRatFn(a)
    const y = toRatFn(b)
    return x.n.mul(y.d).eq(y.n.mul(x.d))
  } catch (e) {
    if (!(e instanceof NonPolynomial)) throw e
  }
  const vars = [...variables(a, variables(b))]
  let compared = 0
  for (let i = 0; i < SAMPLES.length; i++) {
    const env = sampleEnv(vars, i)
    for (const v of vars) env[v] = Math.abs(env[v]) + 0.5 // keep square roots real
    const [p, q] = [evaluate(a, env), evaluate(b, env)]
    if (!Number.isFinite(p) || !Number.isFinite(q)) continue
    if (!close(p, q)) return false
    compared++
  }
  return compared >= 3
}

/**
 * The polynomial whose zeros are the solutions of an equation line:
 * the product over the "or" branches of numerator(lhs - rhs).
 * "No solution" becomes the constant 1 (never zero).
 */
export function zeroPoly(line: Line & { kind: 'eq' }): Poly {
  return line.parts.reduce((acc, p) => acc.mul(toRatFn(sub(p.lhs, p.rhs)).n), Poly.constant(ONE))
}

export type Complex = [number, number]

/** All complex roots of c[0] + c[1] x + ... (Durand-Kerner), deduplicated. */
export function polyRoots(coeffs: number[]): Complex[] {
  const c = coeffs.slice()
  while (c.length && Math.abs(c[c.length - 1]) < 1e-12) c.pop()
  const n = c.length - 1
  if (n < 1) return []
  const lead = c[n]
  const a = c.map((x) => x / lead)
  let roots: Complex[] = Array.from({ length: n }, (_, k) => {
    const ang = (2 * Math.PI * k) / n + 0.4
    const r = 1 + Math.max(...a.slice(0, n).map(Math.abs))
    return [r * 0.6 * Math.cos(ang), r * 0.6 * Math.sin(ang)] as Complex
  })
  const evalAt = ([x, y]: Complex): Complex => {
    let [re, im] = [1, 0]
    for (let i = n - 1; i >= 0; i--) [re, im] = [re * x - im * y + a[i], re * y + im * x]
    return [re, im]
  }
  for (let iter = 0; iter < 500; iter++) {
    let moved = 0
    roots = roots.map((z, i) => {
      let [dr, di] = [1, 0]
      roots.forEach((w, j) => {
        if (i === j) return
        const [u, v] = [z[0] - w[0], z[1] - w[1]]
        ;[dr, di] = [dr * u - di * v, dr * v + di * u]
      })
      const [pr, pi] = evalAt(z)
      const den = dr * dr + di * di || 1e-30
      const step: Complex = [(pr * dr + pi * di) / den, (pi * dr - pr * di) / den]
      moved = Math.max(moved, Math.hypot(...step))
      return [z[0] - step[0], z[1] - step[1]]
    })
    if (moved < 1e-13) break
  }
  const out: Complex[] = []
  for (const z of roots) {
    const clean: Complex = [snap(z[0]), Math.abs(z[1]) < 1e-6 ? 0 : z[1]]
    if (!out.some((w) => Math.hypot(w[0] - clean[0], w[1] - clean[1]) < 1e-5)) out.push(clean)
  }
  return out.sort((p, q) => p[0] - q[0] || p[1] - q[1])
}

/** Rounds away float noise near "nice" values so 2.9999999 prints as 3. */
function snap(x: number): number {
  const r = Math.round(x * 1e6) / 1e6
  return Math.abs(r - x) < 1e-7 ? r : x
}

export type Solutions =
  | { type: 'roots'; variable: string; roots: Complex[] }
  | { type: 'all' } // identity, true for every value
  | { type: 'none' }
  | { type: 'unknown' } // several variables, or not polynomial

export function solutionsOf(line: Line & { kind: 'eq' }): Solutions {
  let p: Poly
  try {
    p = zeroPoly(line)
  } catch {
    return { type: 'unknown' }
  }
  if (p.isZero()) return { type: 'all' }
  const vars = p.variables()
  if (vars.length === 0) return { type: 'none' }
  if (vars.length > 1) return { type: 'unknown' }
  const coeffs = p.coefficientsIn(vars[0])
  if (!coeffs) return { type: 'unknown' }
  // Roots that make a denominator zero are not solutions.
  const banned = line.parts.flatMap((part) => {
    try {
      const d = toRatFn(sub(part.lhs, part.rhs)).d.coefficientsIn(vars[0])
      return d ? polyRoots(d) : []
    } catch {
      return []
    }
  })
  const roots = polyRoots(coeffs).filter((z) => !banned.some((b) => Math.hypot(b[0] - z[0], b[1] - z[1]) < 1e-5))
  return { type: 'roots', variable: vars[0], roots }
}

const sameRoot = (a: Complex, b: Complex) => Math.hypot(a[0] - b[0], a[1] - b[1]) < 1e-5

export type Relation = 'same' | 'lost' | 'extra' | 'different' | 'unknown'

/** How the solution set of `cur` relates to the solution set of `prev`. */
export function compareSolutions(prev: Line & { kind: 'eq' }, cur: Line & { kind: 'eq' }): Relation {
  try {
    const [p, q] = [zeroPoly(prev), zeroPoly(cur)]
    if (p.proportionalTo(q)) return 'same'
  } catch (e) {
    if (!(e instanceof NonPolynomial)) throw e
    return numericEquationCheck(prev, cur)
  }
  const [a, b] = [solutionsOf(prev), solutionsOf(cur)]
  if (a.type === 'unknown' || b.type === 'unknown') return 'different'
  if (a.type !== 'roots' || b.type !== 'roots') {
    if (a.type === b.type) return 'same'
    // "none" behaves like an empty root list.
    const ra = a.type === 'roots' ? a.roots.length : a.type === 'none' ? 0 : Infinity
    const rb = b.type === 'roots' ? b.roots.length : b.type === 'none' ? 0 : Infinity
    if (ra === rb) return 'same'
    return rb < ra ? 'lost' : 'extra'
  }
  if (a.variable !== b.variable) return 'different'
  const missing = a.roots.filter((r) => !b.roots.some((s) => sameRoot(r, s)))
  const added = b.roots.filter((r) => !a.roots.some((s) => sameRoot(r, s)))
  if (!missing.length && !added.length) return 'same'
  if (missing.length && !added.length) return 'lost'
  if (added.length && !missing.length) return 'extra'
  return 'different'
}

/** Fallback when exact arithmetic is impossible: is (lhs-rhs) a constant multiple across samples? */
function numericEquationCheck(prev: Line & { kind: 'eq' }, cur: Line & { kind: 'eq' }): Relation {
  if (prev.parts.length !== 1 || cur.parts.length !== 1) return 'unknown'
  const f = sub(prev.parts[0].lhs, prev.parts[0].rhs)
  const g = sub(cur.parts[0].lhs, cur.parts[0].rhs)
  const vars = [...variables(f, variables(g))]
  let ratio: number | null = null
  let compared = 0
  for (let i = 0; i < SAMPLES.length; i++) {
    const env = sampleEnv(vars, i)
    for (const v of vars) env[v] = Math.abs(env[v]) + 0.5
    const [p, q] = [evaluate(f, env), evaluate(g, env)]
    if (!Number.isFinite(p) || !Number.isFinite(q) || Math.abs(q) < 1e-9) continue
    if (ratio === null) ratio = p / q
    else if (!close(ratio, p / q)) return 'unknown'
    compared++
  }
  return compared >= 3 && ratio !== null && Math.abs(ratio) > 1e-9 ? 'same' : 'unknown'
}

/** Is `cur` a mathematically valid consequence of `prev`? */
export function sameLine(prev: Line, cur: Line): boolean {
  if (prev.kind !== cur.kind) return false
  if (prev.kind === 'expr' && cur.kind === 'expr') return sameExpression(prev.node, cur.node)
  if (prev.kind === 'eq' && cur.kind === 'eq') return compareSolutions(prev, cur) === 'same'
  return false
}

/* ------------------------------ Counterexamples ----------------------------- */

export interface Counterexample {
  /** Variable assignment, for example { x: 2 }. */
  at: Record<string, number>
  /** Human-readable facts verified numerically. */
  prevSays: string
  curSays: string
}

const fmt = (x: number) => {
  const r = Math.round(x * 1000) / 1000
  return Object.is(r, -0) ? '0' : String(r)
}

const NICE = [2, 1, 3, 0, -1, 4, -2, 5, 10, -3]

/**
 * A concrete number check that separates two lines, in terms a student can verify by hand.
 * For expressions: a value where they differ. For equations: a solution of one that fails the other.
 */
export function counterexample(prev: Line, cur: Line): Counterexample | null {
  if (prev.kind === 'expr' && cur.kind === 'expr') {
    const vars = [...variables(prev.node, variables(cur.node))].sort()
    const tuples = vars.length <= 1 ? NICE.map((v) => [v]) : NICE.flatMap((a) => NICE.slice(0, 5).map((b) => [a, b, a + b]))
    for (const tuple of tuples) {
      const env = Object.fromEntries(vars.map((v, i) => [v, tuple[i % tuple.length]]))
      const [p, q] = [evaluate(prev.node, env), evaluate(cur.node, env)]
      if (Number.isFinite(p) && Number.isFinite(q) && !close(p, q))
        return { at: env, prevSays: `the line above equals ${fmt(p)}`, curSays: `your line equals ${fmt(q)}` }
    }
    return null
  }
  if (prev.kind === 'eq' && cur.kind === 'eq') {
    const [a, b] = [solutionsOf(prev), solutionsOf(cur)]
    if (a.type !== 'roots' && b.type !== 'roots') return null
    const variable = a.type === 'roots' ? a.variable : (b as Solutions & { type: 'roots' }).variable
    const real = (s: Solutions) => (s.type === 'roots' ? s.roots.filter((z) => z[1] === 0).map((z) => z[0]) : [])
    const holds = (line: Line & { kind: 'eq' }, x: number) =>
      line.parts.some((p) => close(evaluate(p.lhs, { [variable]: x }), evaluate(p.rhs, { [variable]: x })))
    const describe = (line: Line & { kind: 'eq' }, x: number) => {
      const p = line.parts[0]
      if (!p) return 'there is no solution at all'
      const [l, r] = [evaluate(p.lhs, { [variable]: x }), evaluate(p.rhs, { [variable]: x })]
      const ok = holds(line, x)
      return `${fmt(l)} ${ok ? '=' : '≠'} ${fmt(r)}`
    }
    for (const x of real(a))
      if (!holds(cur, x))
        return { at: { [variable]: x }, prevSays: `the line above is true (${describe(prev, x)})`, curSays: `your line is false (${describe(cur, x)})` }
    for (const x of real(b))
      if (!holds(prev, x))
        return { at: { [variable]: x }, prevSays: `the line above is false (${describe(prev, x)})`, curSays: `your line is true (${describe(cur, x)})` }
  }
  return null
}

export { add, mul, neg }
