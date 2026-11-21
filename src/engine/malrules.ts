/**
 * Mal-rules: the well-documented *wrong* rules students apply in algebra.
 *
 * Model tracing works like this: take the student's previous (correct) line, apply one
 * mal-rule to it, and if the result is mathematically identical to what the student wrote
 * next, that mal-rule explains the mistake. Because candidates are compared by equivalence
 * and not by spelling, the student may have tidied up in the same line and still be matched.
 */
import {
  type Node,
  type Rewrite,
  add,
  div,
  factorsOf,
  mul,
  neg,
  num,
  pow,
  rewriteAnywhere,
  sqrt,
  sym,
  termsOf,
  toTex,
  toText,
} from './ast'
import { type Equation, type Line, compareSolutions, eqLine, exprLine, lineToTex, sameLine, solutionsOf } from './line'
import { NonPolynomial, Poly, toRatFn } from './poly'
import { ONE, Rat } from './rational'

export type MisconceptionId =
  | 'distribute-partial'
  | 'negative-distribution'
  | 'power-over-sum'
  | 'exponent-rules'
  | 'unlike-terms'
  | 'fraction-add'
  | 'cancel-across-sum'
  | 'move-sign'
  | 'divide-every-term'
  | 'multiply-every-term'
  | 'inverse-operation'
  | 'zero-product'
  | 'forgot-plus-minus'
  | 'root-sign'
  | 'lost-solution'
  | 'extraneous-solution'
  | 'sign-slip'
  | 'arithmetic-slip'
  | 'dropped-term'
  | 'unknown'

export interface Diagnosis {
  id: MisconceptionId
  /** TeX of the fragment the student started from, what they turned it into, and what it should be. */
  from?: string
  wrong?: string
  right?: string
  /** The whole corrected line, when the engine can produce one. */
  fix?: Line
}

/* --------------------------------- Helpers --------------------------------- */

type Mono = { c: Rat; m: Record<string, number> }

/** The node as a single monomial (coefficient times variables), or null. */
function monoOf(n: Node): Mono | null {
  try {
    const r = toRatFn(n)
    const d = r.d.asConstant()
    if (!d) return null
    if (r.n.isZero()) return { c: Rat.of(0), m: {} }
    const mono = r.n.asMonomial()
    return mono ? { c: mono.c.div(d), m: mono.m } : null
  } catch {
    return null
  }
}

const monoKey = (m: Record<string, number>) =>
  Object.keys(m)
    .sort()
    .map((k) => `${k}^${m[k]}`)
    .join('*')

function monoNode({ c, m }: Mono): Node {
  const vars = Object.keys(m)
    .sort()
    .map((k) => {
      const base = k.startsWith('√') ? sqrt(num(Number(k.slice(1)))) : sym(k)
      return m[k] === 1 ? base : pow(base, num(m[k]))
    })
  if (vars.length === 0) return num(c)
  const body = mul(...vars)
  const mag = c.abs()
  let out: Node
  if (mag.isOne()) out = body
  else if (mag.isInt()) out = mul(num(mag), body)
  else out = div(mag.n === 1n ? body : mul(num(Rat.of(mag.n)), body), num(Rat.of(mag.d)))
  return c.isNeg() ? neg(out) : out
}

function polyNode(p: Poly): Node {
  const monos = [...p.terms.values()].sort((a, b) => {
    const deg = (x: Mono) => Object.entries(x.m).reduce((s, [k, e]) => s + (k.startsWith('√') ? 0 : e), 0)
    return deg(b) - deg(a) || monoKey(a.m).localeCompare(monoKey(b.m))
  })
  return add(...monos.map(monoNode))
}

/** Tidies an expression for display (expands and collects) when it is a polynomial. */
export function pretty(n: Node): Node {
  try {
    const r = toRatFn(n)
    const d = r.d.asConstant()
    if (d) return polyNode(r.n.scale(ONE.div(d)))
  } catch (e) {
    if (!(e instanceof NonPolynomial)) throw e
  }
  return n
}

const isNegative = (n: Node): boolean => {
  const m = monoOf(n)
  return m ? m.c.isNeg() : n.t === 'neg'
}

/** A local wrong rewrite of one sub-expression, with the correct version for comparison. */
interface Slip {
  wrong: Node
  right: Node | null
}
type LocalRule = { id: MisconceptionId; apply: (n: Node) => Slip[] }

/** Splits k·(a + b + ...) into the multiplier and the bracket, seeing through a leading minus. */
function multiplierAndSum(n: Node): { k: Node; terms: Node[] } | null {
  let outer: Node[] = []
  let body = n
  if (body.t === 'neg') {
    outer = [num(-1)]
    body = body.x
  }
  if (body.t === 'add') return outer.length ? { k: num(-1), terms: body.a } : null
  if (body.t !== 'mul') return null
  const sums = body.a.filter((f) => f.t === 'add')
  if (sums.length !== 1) return null
  const rest = body.a.filter((f) => f.t !== 'add')
  if (rest.length === 0 && outer.length === 0) return null
  const sum = sums[0]
  return sum.t === 'add' ? { k: mul(...outer, ...rest), terms: sum.a } : null
}

const LOCAL_RULES: LocalRule[] = [
  {
    // -(a + b) -> -a + b ;  -2(x - 3) -> -2x - 6
    id: 'negative-distribution',
    apply(n) {
      const s = multiplierAndSum(n)
      if (!s || !isNegative(s.k) || s.terms.length < 2) return []
      const right = add(...s.terms.map((t) => mul(s.k, t)))
      const wrong = add(...s.terms.map((t, i) => mul(i === 0 ? s.k : neg(s.k), t)))
      return [{ wrong, right }]
    },
  },
  {
    // 2(x + 3) -> 2x + 3
    id: 'distribute-partial',
    apply(n) {
      const s = multiplierAndSum(n)
      if (!s || n.t === 'neg') return []
      const right = add(...s.terms.map((t) => mul(s.k, t)))
      return s.terms.map((_, i) => ({ wrong: add(...s.terms.map((t, j) => (i === j ? mul(s.k, t) : t))), right }))
    },
  },
  {
    // (a + b)^2 -> a^2 + b^2
    id: 'power-over-sum',
    apply(n) {
      if (n.t === 'sqrt' && n.x.t === 'add') return [{ wrong: add(...n.x.a.map((t) => sqrt(t))), right: null }]
      if (n.t !== 'pow' || n.b.t !== 'add' || n.e.t !== 'num' || !n.e.v.isInt()) return []
      const e = Number(n.e.v.n)
      if (e < 2 || e > 4) return []
      const out: Slip[] = [{ wrong: add(...n.b.a.map((t) => pow(t, n.e))), right: n }]
      // (x - 3)^2 -> x^2 - 9 keeps the minus sign on the second square
      if (n.b.a.some((t) => t.t === 'neg' || isNegative(t)))
        out.push({ wrong: add(...n.b.a.map((t) => (isNegative(t) ? neg(pow(neg(t), n.e)) : pow(t, n.e)))), right: n })
      return out
    },
  },
  {
    // x^2 · x^3 -> x^6 ;  (x^2)^3 -> x^5 ;  x · x -> 2x
    id: 'exponent-rules',
    apply(n) {
      const out: Slip[] = []
      if (n.t === 'pow' && n.b.t === 'pow') out.push({ wrong: pow(n.b.b, add(n.b.e, n.e)), right: pow(n.b.b, mul(n.b.e, n.e)) })
      if (n.t === 'mul') {
        const parts = n.a.map((f) => (f.t === 'pow' ? { b: f.b, e: f.e } : { b: f, e: num(1) }))
        for (let i = 0; i < parts.length; i++)
          for (let j = i + 1; j < parts.length; j++) {
            if (parts[i].b.t === 'num' || toText(parts[i].b) !== toText(parts[j].b)) continue
            const others = n.a.filter((_, k) => k !== i && k !== j)
            const base = parts[i].b
            const right = mul(...others, pow(base, add(parts[i].e, parts[j].e)))
            out.push({ wrong: mul(...others, pow(base, mul(parts[i].e, parts[j].e))), right })
            if (toText(parts[i].e) === toText(parts[j].e)) out.push({ wrong: mul(...others, num(2), n.a[i]), right })
          }
      }
      return out
    },
  },
  {
    // 2x + 3 -> 5x ;  x^2 + x -> 2x^2 ;  x + x -> x^2
    id: 'unlike-terms',
    apply(n) {
      if (n.t !== 'add') return []
      const monos = n.a.map(monoOf)
      const out: Slip[] = []
      for (let i = 0; i < n.a.length; i++)
        for (let j = i + 1; j < n.a.length; j++) {
          const [a, b] = [monos[i], monos[j]]
          if (!a || !b) continue
          const others = n.a.filter((_, k) => k !== i && k !== j)
          const [ka, kb] = [monoKey(a.m), monoKey(b.m)]
          if (ka === kb) {
            // like terms multiplied instead of added: x + x -> x^2
            if (ka !== '') {
              const m = Object.fromEntries(Object.entries(a.m).map(([k, e]) => [k, e * 2]))
              out.push({ wrong: add(...others, monoNode({ c: a.c.mul(b.c), m })), right: add(...others, monoNode({ c: a.c.add(b.c), m: a.m })) })
            }
            continue
          }
          const sum = a.c.add(b.c)
          for (const m of [a.m, b.m]) if (monoKey(m) !== '') out.push({ wrong: add(...others, monoNode({ c: sum, m })), right: null })
          if (ka !== '' && kb !== '') {
            const m: Record<string, number> = { ...a.m }
            for (const [k, e] of Object.entries(b.m)) m[k] = (m[k] ?? 0) + e
            out.push({ wrong: add(...others, monoNode({ c: sum, m })), right: null })
            out.push({ wrong: add(...others, monoNode({ c: a.c.mul(b.c), m })), right: null })
          }
        }
      return out
    },
  },
  {
    // a/b + c/d -> (a + c)/(b + d)
    id: 'fraction-add',
    apply(n) {
      if (n.t !== 'add') return []
      const fr = n.a.map((t) => (t.t === 'div' ? { n: t.n, d: t.d } : t.t === 'neg' && t.x.t === 'div' ? { n: neg(t.x.n), d: t.x.d } : null))
      const out: Slip[] = []
      for (let i = 0; i < n.a.length; i++)
        for (let j = i + 1; j < n.a.length; j++) {
          const [a, b] = [fr[i], fr[j]]
          if (!a || !b) continue
          const others = n.a.filter((_, k) => k !== i && k !== j)
          out.push({
            wrong: add(...others, div(add(a.n, b.n), add(a.d, b.d))),
            right: add(...others, div(add(mul(a.n, b.d), mul(b.n, a.d)), mul(a.d, b.d))),
          })
        }
      return out
    },
  },
  {
    // (2x + 6)/2 -> x + 6 ;  (x + 3)/x -> 3
    id: 'cancel-across-sum',
    apply(n) {
      if (n.t !== 'div' || n.n.t !== 'add') return []
      const d = monoOf(n.d)
      if (!d || d.c.isZero() || (d.c.isOne() && monoKey(d.m) === '')) return []
      const terms = n.n.a
      const right = add(...terms.map((t) => div(t, n.d)))
      const out: Slip[] = []
      terms.forEach((t, i) => {
        const m = monoOf(t)
        if (!m || m.c.isZero()) return
        const q: Mono = { c: m.c.div(d.c), m: { ...m.m } }
        for (const [k, e] of Object.entries(d.m)) q.m[k] = (q.m[k] ?? 0) - e
        if (Object.values(q.m).some((e) => e < 0)) return
        for (const k of Object.keys(q.m)) if (q.m[k] === 0) delete q.m[k]
        const others = terms.filter((_, j) => j !== i)
        out.push({ wrong: add(monoNode(q), ...others), right })
        if (q.c.isOne() && monoKey(q.m) === '') out.push({ wrong: add(...others), right })
      })
      return out
    },
  },
]

/* ------------------------------ Equation rules ------------------------------ */

interface Candidate {
  id: MisconceptionId
  line: Line
  from?: string
  wrong?: string
  right?: string
  fix?: Line
}

const eqTex = (e: Equation) => `${toTex(e.lhs)} = ${toTex(e.rhs)}`
const tidyEq = (e: Equation): Equation => ({ lhs: pretty(e.lhs), rhs: pretty(e.rhs) })

function equationCandidates(eq: Equation, rebuild: (e: Equation) => Line): Candidate[] {
  const out: Candidate[] = []
  const L = termsOf(eq.lhs)
  const R = termsOf(eq.rhs)
  const sides = [
    { own: L, other: R, make: (own: Node, other: Node): Equation => ({ lhs: own, rhs: other }) },
    { own: R, other: L, make: (own: Node, other: Node): Equation => ({ lhs: other, rhs: own }) },
  ]
  const push = (id: MisconceptionId, wrong: Equation, right: Equation | null, from = eqTex(eq)) =>
    out.push({
      id,
      line: rebuild(wrong),
      from,
      wrong: eqTex(tidyEq(wrong)),
      right: right ? eqTex(tidyEq(right)) : undefined,
      fix: right ? rebuild(tidyEq(right)) : undefined,
    })

  // Moving a term across the equals sign without changing its sign: 2x + 3 = 11 -> 2x = 11 + 3
  for (const s of sides)
    s.own.forEach((t, i) => {
      if (monoOf(t)?.c.isZero()) return
      const rest = add(...s.own.filter((_, j) => j !== i))
      push('move-sign', s.make(rest, add(...s.other, t)), s.make(rest, add(...s.other, neg(t))))
    })

  // Dividing through by k but not dividing every term: 2x + 6 = 10 -> x + 6 = 5
  const all = [...L.map((t) => ({ t, left: true })), ...R.map((t) => ({ t, left: false }))]
  const build = (f: (t: Node, i: number) => Node): Equation => ({
    lhs: add(...all.filter((x) => x.left).map((x) => f(x.t, all.indexOf(x)))),
    rhs: add(...all.filter((x) => !x.left).map((x) => f(x.t, all.indexOf(x)))),
  })
  const divisors = new Map<string, Rat>()
  const multipliers = new Map<string, Rat>()
  for (const { t } of all) {
    const m = monoOf(t)
    if (m && monoKey(m.m) !== '' && m.c.isInt() && !m.c.abs().isOne() && !m.c.isZero()) divisors.set(m.c.toString(), m.c)
    try {
      const r = toRatFn(t)
      const d = r.d.asConstant()
      if (!d) continue
      for (const { c } of r.n.terms.values()) {
        const den = Rat.of(c.div(d).d)
        if (!den.isOne()) multipliers.set(den.toString(), den)
      }
    } catch {
      /* not polynomial: skip */
    }
  }
  if (all.length >= 2) {
    for (const k of divisors.values()) {
      const right = build((t) => div(t, num(k)))
      all.forEach((_, skip) => push('divide-every-term', build((t, i) => (i === skip ? t : div(t, num(k)))), right))
      if (all.length > 2) all.forEach((_, only) => push('divide-every-term', build((t, i) => (i === only ? div(t, num(k)) : t)), right))
    }
    for (const k of multipliers.values()) {
      const right = build((t) => mul(num(k), t))
      all.forEach((_, skip) => push('multiply-every-term', build((t, i) => (i === skip ? t : mul(num(k), t))), right))
    }
  }

  // Undoing with the wrong operation: 3x = 12 -> x = 12 - 3 ;  x + 4 = 12 -> x = 12/4
  for (const s of sides) {
    const other = add(...s.other)
    if (s.own.length === 1) {
      const m = monoOf(s.own[0])
      if (m && monoKey(m.m) !== '' && !m.c.abs().isOne()) {
        const v = monoNode({ c: Rat.of(1), m: m.m })
        const k = num(m.c)
        const right = s.make(v, div(other, k))
        for (const wrong of [add(other, neg(k)), add(other, k), mul(k, other), div(k, other)]) push('inverse-operation', s.make(v, wrong), right)
      }
    }
    if (s.own.length === 2) {
      s.own.forEach((t, i) => {
        const [m, c] = [monoOf(t), monoOf(s.own[1 - i])]
        if (!m || !c || monoKey(m.m) === '' || monoKey(c.m) !== '' || c.c.isZero()) return
        const right = s.make(t, add(other, neg(num(c.c))))
        for (const wrong of [div(other, num(c.c)), mul(num(c.c), other)]) push('inverse-operation', s.make(t, wrong), right)
      })
    }
  }

  return out
}

/** (x - 2)(x + 3) = 6  ->  x - 2 = 6 or x + 3 = 6 */
function zeroProductCandidates(eq: Equation, replaceWith: (parts: Equation[]) => Line): Candidate[] {
  const out: Candidate[] = []
  for (const [prod, other] of [
    [eq.lhs, eq.rhs],
    [eq.rhs, eq.lhs],
  ]) {
    const c = monoOf(other)
    const factors = factorsOf(prod).filter((f) => monoOf(f)?.m === undefined || monoKey(monoOf(f)!.m) !== '')
    if (!c || monoKey(c.m) !== '' || c.c.isZero() || factors.length < 2) continue
    out.push({
      id: 'zero-product',
      line: replaceWith(factors.map((f) => ({ lhs: f, rhs: other }))),
      from: eqTex(eq),
      wrong: factors.map((f) => `${toTex(f)} = ${toTex(other)}`).join('\\ \\text{ or }\\ '),
      right: `${toTex(pretty(add(prod, neg(other))))} = 0`,
    })
  }
  return out
}

/* --------------------------------- Matching -------------------------------- */

function sidesOf(line: Line): { node: Node; put: (n: Node) => Line }[] {
  if (line.kind === 'expr') return [{ node: line.node, put: (n) => exprLine(n) }]
  return line.parts.flatMap((p, i) => {
    const swap = (e: Equation) => eqLine(...line.parts.map((q, j) => (i === j ? e : q)))
    return [
      { node: p.lhs, put: (n: Node) => swap({ lhs: n, rhs: p.rhs }) },
      { node: p.rhs, put: (n: Node) => swap({ lhs: p.lhs, rhs: n }) },
    ]
  })
}

function numbersIn(line: Line): Rat[] {
  const out: Rat[] = []
  const walk = (n: Node) => {
    if (n.t === 'num') out.push(n.v.abs())
    else if (n.t === 'add' || n.t === 'mul') n.a.forEach(walk)
    else if (n.t === 'div') [n.n, n.d].forEach(walk)
    else if (n.t === 'pow') walk(n.b)
    else if (n.t === 'neg' || n.t === 'sqrt') walk(n.x)
  }
  sidesOf(line).forEach((s) => walk(s.node))
  return out
}

/**
 * Explains why `cur` does not follow from `prev`.
 * Precondition: the two lines are already known to be inequivalent.
 */
export function diagnose(prev: Line, cur: Line): Diagnosis {
  // 1. Local mal-rules applied anywhere in the previous line.
  for (const rule of LOCAL_RULES) {
    for (const side of sidesOf(prev)) {
      const rights = new Map<Node, Node | null>()
      const rewrites: Rewrite[] = rewriteAnywhere(side.node, (n) =>
        rule.apply(n).map((s) => {
          rights.set(s.wrong, s.right)
          return s.wrong
        }),
      )
      for (const rw of rewrites) {
        if (!sameLine(side.put(rw.tree), cur)) continue
        const right = rights.get(rw.after)
        const fix = right ? side.put(rewriteOnce(side.node, rw.before, right)) : undefined
        return {
          id: rule.id,
          from: toTex(rw.before),
          wrong: toTex(pretty(rw.after)),
          right: right ? toTex(pretty(right)) : undefined,
          fix,
        }
      }
    }
  }

  // 2. Equation-level mal-rules.
  if (prev.kind === 'eq' && cur.kind === 'eq') {
    const candidates = prev.parts.flatMap((p, i) => {
      const rebuild = (e: Equation) => eqLine(...prev.parts.map((q, j) => (i === j ? e : q)))
      const replaceWith = (parts: Equation[]) => eqLine(...prev.parts.flatMap((q, j) => (i === j ? parts : [q])))
      return [...zeroProductCandidates(p, replaceWith), ...equationCandidates(p, rebuild)]
    })
    const order: MisconceptionId[] = ['zero-product', 'move-sign', 'divide-every-term', 'multiply-every-term', 'inverse-operation']
    candidates.sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id))
    for (const c of candidates) if (sameLine(c.line, cur)) return { id: c.id, from: c.from, wrong: c.wrong, right: c.right, fix: c.fix }

    // 3. What happened to the solution set?
    const relation = compareSolutions(prev, cur)
    const [a, b] = [solutionsOf(prev), solutionsOf(cur)]
    if (a.type === 'roots' && b.type === 'roots') {
      const missing = a.roots.filter((r) => !b.roots.some((s) => Math.hypot(r[0] - s[0], r[1] - s[1]) < 1e-5))
      if (relation === 'lost' && b.roots.length && missing.every((r) => b.roots.some((s) => Math.hypot(r[0] + s[0], r[1] + s[1]) < 1e-5)))
        return { id: 'forgot-plus-minus', wrong: lineToTex(cur) }
      if (relation === 'different' && a.roots.length === b.roots.length && a.roots.every((r) => b.roots.some((s) => Math.hypot(r[0] + s[0], r[1] + s[1]) < 1e-5)))
        return { id: 'root-sign', from: lineToTex(prev), wrong: lineToTex(cur) }
    }
  }

  // 4. Work backwards from the student's line: would one flipped sign make it right?
  for (const side of sidesOf(cur)) {
    const flips = rewriteAnywhere(side.node, (n) => (n.t === 'add' || n.t === 'neg' ? [] : [neg(n)]))
    for (const rw of flips) {
      const fixed = side.put(rw.tree)
      if (sameLine(prev, fixed)) return { id: 'sign-slip', wrong: toTex(rw.before), right: toTex(rw.after), fix: fixed }
    }
  }

  // 5. Would changing one number make it right? Try values built from the numbers in the line above.
  const pool = numbersIn(prev)
  const values = new Map<string, Rat>()
  const offer = (r: Rat) => values.set(r.toString(), r)
  for (const x of pool)
    for (const y of pool) {
      for (const r of [x.add(y), x.sub(y), x.mul(y)]) offer(r)
      if (!y.isZero()) offer(x.div(y))
    }
  pool.forEach((x) => offer(x.mul(x)))
  for (const side of sidesOf(cur)) {
    const swaps = rewriteAnywhere(side.node, (n) =>
      n.t === 'num' ? [...values.values()].filter((v) => !v.eq(n.v) && !v.neg().eq(n.v)).flatMap((v) => [num(v), num(v.neg())]) : [],
    )
    for (const rw of swaps) {
      const fixed = side.put(rw.tree)
      if (sameLine(prev, fixed)) return { id: 'arithmetic-slip', wrong: toTex(rw.before), right: toTex(rw.after), fix: fixed }
    }
  }

  // 6. A term that simply vanished from the previous line.
  for (const side of sidesOf(prev)) {
    const terms = termsOf(side.node)
    if (terms.length < 2) continue
    for (let i = 0; i < terms.length; i++) {
      const without = add(...terms.filter((_, j) => j !== i))
      if (sameLine(side.put(without), cur)) return { id: 'dropped-term', from: toTex(side.node), wrong: toTex(without), right: undefined }
    }
  }

  if (prev.kind === 'eq' && cur.kind === 'eq') {
    const relation = compareSolutions(prev, cur)
    if (relation === 'lost') return { id: 'lost-solution', from: lineToTex(prev), wrong: lineToTex(cur) }
    if (relation === 'extra') return { id: 'extraneous-solution', from: lineToTex(prev), wrong: lineToTex(cur) }
  }
  return { id: 'unknown' }
}

/** Replaces the first occurrence (by identity) of `target` inside `root`. */
function rewriteOnce(root: Node, target: Node, replacement: Node): Node {
  const hit = rewriteAnywhere(root, (n) => (n === target ? [replacement] : []))
  return hit.length ? hit[0].tree : root
}
