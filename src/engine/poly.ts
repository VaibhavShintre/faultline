import type { Node } from './ast'
import { Rat, ZERO, ONE } from './rational'

/** Raised when an expression is outside exact polynomial arithmetic (for example sqrt(x)). */
export class NonPolynomial extends Error {}

type Mono = Record<string, number> // variable name -> exponent

const keyOf = (m: Mono) =>
  Object.keys(m)
    .filter((k) => m[k] !== 0)
    .sort()
    .map((k) => `${k}^${m[k]}`)
    .join('*')

/** Surd symbols look like "√5" and satisfy (√5)^2 = 5. */
const isSurd = (name: string) => name.startsWith('√')
const surdValue = (name: string) => Rat.of(BigInt(name.slice(1)))

/** Multivariate polynomial with exact rational coefficients. Immutable. */
export class Poly {
  readonly terms: Map<string, { c: Rat; m: Mono }>

  constructor(terms?: Map<string, { c: Rat; m: Mono }>) {
    this.terms = terms ?? new Map()
  }

  static constant(c: Rat): Poly {
    return new Poly().plusTerm(c, {})
  }
  static variable(name: string): Poly {
    return new Poly().plusTerm(ONE, { [name]: 1 })
  }

  private plusTerm(c: Rat, m: Mono): Poly {
    // Reduce surd powers: (√r)^2 -> r
    const mono: Mono = {}
    for (const [k, e] of Object.entries(m)) {
      if (e === 0) continue
      if (isSurd(k)) {
        c = c.mul(surdValue(k).pow(Math.floor(e / 2)))
        if (e % 2) mono[k] = 1
      } else {
        mono[k] = e
      }
    }
    if (c.isZero()) return this
    const next = new Map(this.terms)
    const key = keyOf(mono)
    const sum = (next.get(key)?.c ?? ZERO).add(c)
    if (sum.isZero()) next.delete(key)
    else next.set(key, { c: sum, m: mono })
    return new Poly(next)
  }

  add(o: Poly): Poly {
    let out: Poly = this
    for (const { c, m } of o.terms.values()) out = out.plusTerm(c, m)
    return out
  }
  neg(): Poly {
    return this.scale(Rat.of(-1))
  }
  sub(o: Poly): Poly {
    return this.add(o.neg())
  }
  scale(k: Rat): Poly {
    let out = new Poly()
    for (const { c, m } of this.terms.values()) out = out.plusTerm(c.mul(k), m)
    return out
  }
  mul(o: Poly): Poly {
    let out = new Poly()
    for (const a of this.terms.values())
      for (const b of o.terms.values()) {
        const m: Mono = { ...a.m }
        for (const [k, e] of Object.entries(b.m)) m[k] = (m[k] ?? 0) + e
        out = out.plusTerm(a.c.mul(b.c), m)
      }
    return out
  }
  pow(e: number): Poly {
    if (e > 12) throw new NonPolynomial('Exponent too large')
    let out = Poly.constant(ONE)
    for (let i = 0; i < e; i++) out = out.mul(this)
    return out
  }

  isZero(): boolean {
    return this.terms.size === 0
  }
  eq(o: Poly): boolean {
    return this.sub(o).isZero()
  }
  /** The constant value, or null when the polynomial has variables or surds. */
  asConstant(): Rat | null {
    if (this.terms.size === 0) return ZERO
    if (this.terms.size === 1 && this.terms.has('')) return this.terms.get('')!.c
    return null
  }
  /** Single monomial (coefficient and exponents), or null. */
  asMonomial(): { c: Rat; m: Mono } | null {
    if (this.terms.size !== 1) return null
    return [...this.terms.values()][0]
  }
  /** Real variables (surd symbols excluded). */
  variables(): string[] {
    const s = new Set<string>()
    for (const { m } of this.terms.values()) for (const k of Object.keys(m)) if (!isSurd(k)) s.add(k)
    return [...s].sort()
  }
  /** True when `this = k * o` for some nonzero rational k. */
  proportionalTo(o: Poly): boolean {
    if (this.isZero() || o.isZero()) return this.isZero() && o.isZero()
    if (this.terms.size !== o.terms.size) return false
    const [key, first] = [...this.terms.entries()][0]
    const other = o.terms.get(key)
    if (!other) return false
    return this.eq(o.scale(first.c.div(other.c)))
  }
  /** Numeric coefficients by power of `v`: index i is the coefficient of v^i. Surds are evaluated. */
  coefficientsIn(v: string): number[] | null {
    const out: number[] = []
    for (const { c, m } of this.terms.values()) {
      let k = c.toNumber()
      let deg = 0
      for (const [name, e] of Object.entries(m)) {
        if (name === v) deg = e
        else if (isSurd(name)) k *= Math.sqrt(surdValue(name).toNumber())
        else return null // another variable
      }
      out[deg] = (out[deg] ?? 0) + k
    }
    for (let i = 0; i < out.length; i++) out[i] ??= 0
    return out
  }
  evaluate(env: Record<string, number>): number {
    let total = 0
    for (const { c, m } of this.terms.values()) {
      let k = c.toNumber()
      for (const [name, e] of Object.entries(m)) {
        const base = isSurd(name) ? Math.sqrt(surdValue(name).toNumber()) : env[name]
        k *= base ** e
      }
      total += k
    }
    return total
  }
}

/** Rational function n/d. */
export interface RatFn {
  n: Poly
  d: Poly
}

const P1 = Poly.constant(ONE)

/** sqrt of a rational constant as an exact polynomial in a surd symbol: sqrt(8) -> 2·√2. */
function sqrtOfConstant(c: Rat): Poly {
  if (c.isNeg()) throw new NonPolynomial('Square root of a negative number')
  if (c.isZero()) return new Poly()
  // sqrt(p/q) = sqrt(p*q)/q
  let m = c.n * c.d
  let outside = 1n
  for (let f = 2n; f * f <= m; f++) {
    while (m % (f * f) === 0n) {
      m /= f * f
      outside *= f
    }
  }
  const coeff = new Rat(outside, c.d)
  if (m === 1n) return Poly.constant(coeff)
  return Poly.variable(`√${m}`).scale(coeff)
}

/** Converts an expression to an exact rational function, or throws NonPolynomial. */
export function toRatFn(node: Node): RatFn {
  switch (node.t) {
    case 'num':
      return { n: Poly.constant(node.v), d: P1 }
    case 'var':
      return { n: Poly.variable(node.name), d: P1 }
    case 'neg': {
      const x = toRatFn(node.x)
      return { n: x.n.neg(), d: x.d }
    }
    case 'add':
      return node.a.map(toRatFn).reduce((acc, x) => {
        if (acc.d.eq(x.d)) return { n: acc.n.add(x.n), d: acc.d }
        return { n: acc.n.mul(x.d).add(x.n.mul(acc.d)), d: acc.d.mul(x.d) }
      })
    case 'mul':
      return node.a.map(toRatFn).reduce((acc, x) => ({ n: acc.n.mul(x.n), d: acc.d.mul(x.d) }))
    case 'div': {
      const a = toRatFn(node.n)
      const b = toRatFn(node.d)
      if (b.n.isZero()) throw new NonPolynomial('Division by zero')
      return { n: a.n.mul(b.d), d: a.d.mul(b.n) }
    }
    case 'pow': {
      const e = toRatFn(node.e)
      const ec = e.d.asConstant() && e.n.asConstant() ? e.n.asConstant()!.div(e.d.asConstant()!) : null
      if (!ec) throw new NonPolynomial('Variable exponent')
      const b = toRatFn(node.b)
      if (ec.isInt()) {
        const k = Number(ec.n)
        if (Math.abs(k) > 12) throw new NonPolynomial('Exponent too large')
        if (k >= 0) return { n: b.n.pow(k), d: b.d.pow(k) }
        if (b.n.isZero()) throw new NonPolynomial('Division by zero')
        return { n: b.d.pow(-k), d: b.n.pow(-k) }
      }
      if (ec.d === 2n && ec.n === 1n) return sqrtRatFn(b)
      throw new NonPolynomial('Fractional exponent')
    }
    case 'sqrt':
      return sqrtRatFn(toRatFn(node.x))
  }
}

function sqrtRatFn(x: RatFn): RatFn {
  const n = x.n.asConstant()
  const d = x.d.asConstant()
  if (!n || !d) throw new NonPolynomial('Square root of a variable expression')
  return { n: sqrtOfConstant(n.div(d)), d: P1 }
}

/** Numeric evaluation of any expression (NaN where undefined). */
export function evaluate(node: Node, env: Record<string, number>): number {
  switch (node.t) {
    case 'num':
      return node.v.toNumber()
    case 'var':
      return env[node.name] ?? NaN
    case 'neg':
      return -evaluate(node.x, env)
    case 'add':
      return node.a.reduce((s, c) => s + evaluate(c, env), 0)
    case 'mul':
      return node.a.reduce((s, c) => s * evaluate(c, env), 1)
    case 'div':
      return evaluate(node.n, env) / evaluate(node.d, env)
    case 'pow':
      return evaluate(node.b, env) ** evaluate(node.e, env)
    case 'sqrt':
      return Math.sqrt(evaluate(node.x, env))
  }
}
