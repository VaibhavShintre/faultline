import { Rat } from './rational'

/**
 * Expression tree. Subtraction is stored as addition of a negated term and
 * sums/products are n-ary, so "top-level terms" are simply the children of an `add`.
 */
export type Node =
  | { t: 'num'; v: Rat }
  | { t: 'var'; name: string }
  | { t: 'add'; a: Node[] }
  | { t: 'mul'; a: Node[] }
  | { t: 'div'; n: Node; d: Node }
  | { t: 'pow'; b: Node; e: Node }
  | { t: 'neg'; x: Node }
  | { t: 'sqrt'; x: Node }

export const num = (v: number | Rat): Node => ({ t: 'num', v: typeof v === 'number' ? Rat.of(v) : v })
export const sym = (name: string): Node => ({ t: 'var', name })
export const neg = (x: Node): Node => (x.t === 'neg' ? x.x : { t: 'neg', x })
export const div = (n: Node, d: Node): Node => ({ t: 'div', n, d })
export const pow = (b: Node, e: Node): Node => ({ t: 'pow', b, e })
export const sqrt = (x: Node): Node => ({ t: 'sqrt', x })

export function add(...terms: Node[]): Node {
  const flat = terms.flatMap((x) => (x.t === 'add' ? x.a : [x]))
  if (flat.length === 0) return num(0)
  return flat.length === 1 ? flat[0] : { t: 'add', a: flat }
}

export function mul(...factors: Node[]): Node {
  const flat = factors.flatMap((x) => (x.t === 'mul' ? x.a : [x]))
  if (flat.length === 0) return num(1)
  return flat.length === 1 ? flat[0] : { t: 'mul', a: flat }
}

export const sub = (a: Node, b: Node): Node => add(a, neg(b))

/** Top-level terms of a sum (a non-sum is a single term). */
export const termsOf = (n: Node): Node[] => (n.t === 'add' ? n.a : [n])
/** Top-level factors of a product. */
export const factorsOf = (n: Node): Node[] => (n.t === 'mul' ? n.a : [n])

export function variables(n: Node, out = new Set<string>()): Set<string> {
  switch (n.t) {
    case 'num':
      break
    case 'var':
      out.add(n.name)
      break
    case 'add':
    case 'mul':
      n.a.forEach((c) => variables(c, out))
      break
    case 'div':
      variables(n.n, out)
      variables(n.d, out)
      break
    case 'pow':
      variables(n.b, out)
      variables(n.e, out)
      break
    case 'neg':
    case 'sqrt':
      variables(n.x, out)
      break
  }
  return out
}

export function children(n: Node): Node[] {
  switch (n.t) {
    case 'num':
    case 'var':
      return []
    case 'add':
    case 'mul':
      return n.a
    case 'div':
      return [n.n, n.d]
    case 'pow':
      return [n.b, n.e]
    case 'neg':
    case 'sqrt':
      return [n.x]
  }
}

function withChildren(n: Node, c: Node[]): Node {
  switch (n.t) {
    case 'num':
    case 'var':
      return n
    case 'add':
      return add(...c)
    case 'mul':
      return mul(...c)
    case 'div':
      return div(c[0], c[1])
    case 'pow':
      return pow(c[0], c[1])
    case 'neg':
      return neg(c[0])
    case 'sqrt':
      return sqrt(c[0])
  }
}

export interface Rewrite {
  /** Whole tree after the single local change. */
  tree: Node
  /** The sub-expression that was changed, and what it became. */
  before: Node
  after: Node
}

/**
 * Applies `f` at every position of the tree, one position at a time.
 * `f` returns the alternative forms for that sub-expression (empty when the rule does not apply).
 */
export function rewriteAnywhere(root: Node, f: (n: Node) => Node[]): Rewrite[] {
  const out: Rewrite[] = []
  const visit = (n: Node, rebuild: (replacement: Node) => Node) => {
    for (const after of f(n)) out.push({ tree: rebuild(after), before: n, after })
    const kids = children(n)
    kids.forEach((kid, i) => {
      visit(kid, (replacement) => {
        const next = kids.slice()
        next[i] = replacement
        return rebuild(withChildren(n, next))
      })
    })
  }
  visit(root, (r) => r)
  return out
}

/* ---------------------------------- Parser --------------------------------- */

export class ParseError extends Error {}

type Tok = { k: 'num' | 'id' | 'op'; s: string }

const SUPERSCRIPTS: Record<string, string> = {
  '⁰': '0', '¹': '1', '²': '2', '³': '3', '⁴': '4', '⁵': '5', '⁶': '6', '⁷': '7', '⁸': '8', '⁹': '9',
}

export function normalizeInput(src: string): string {
  return src
    .replace(/[−–—]/g, '-')
    .replace(/[×·⋅]/g, '*')
    .replace(/÷/g, '/')
    .replace(/√/g, 'sqrt')
    .replace(/[⁰¹²³⁴⁵⁶⁷⁸⁹]+/g, (m) => '^' + [...m].map((c) => SUPERSCRIPTS[c]).join(''))
    .replace(/\*\*/g, '^')
}

function tokenize(src: string): Tok[] {
  const toks: Tok[] = []
  const s = normalizeInput(src)
  let i = 0
  while (i < s.length) {
    const c = s[i]
    if (/\s/.test(c)) {
      i++
    } else if (/[0-9.]/.test(c)) {
      let j = i
      while (j < s.length && /[0-9.]/.test(s[j])) j++
      const lit = s.slice(i, j)
      if (!/^(\d+\.?\d*|\.\d+)$/.test(lit)) throw new ParseError(`"${lit}" is not a number`)
      toks.push({ k: 'num', s: lit })
      i = j
    } else if (/[a-zA-Z]/.test(c)) {
      let j = i
      while (j < s.length && /[a-zA-Z]/.test(s[j])) j++
      const word = s.slice(i, j)
      if (word === 'sqrt') toks.push({ k: 'id', s: word })
      else for (const ch of word) toks.push({ k: 'id', s: ch }) // "xy" means x times y
      i = j
    } else if ('+-*/^()'.includes(c)) {
      toks.push({ k: 'op', s: c })
      i++
    } else {
      throw new ParseError(`Unexpected "${c}"`)
    }
  }
  return toks
}

/** Parses one expression (no equals sign). */
export function parseExpr(src: string): Node {
  const toks = tokenize(src)
  let p = 0
  const peek = () => toks[p]
  const isOp = (s: string) => peek()?.k === 'op' && peek().s === s
  const startsPrimary = () => {
    const t = peek()
    return !!t && (t.k === 'num' || t.k === 'id' || (t.k === 'op' && t.s === '('))
  }

  const expr = (): Node => {
    const terms = [term()]
    while (isOp('+') || isOp('-')) {
      const minus = toks[p++].s === '-'
      const t = term()
      terms.push(minus ? neg(t) : t)
    }
    return add(...terms)
  }

  const term = (): Node => {
    let left = unary()
    for (;;) {
      if (isOp('*')) {
        p++
        left = mul(left, unary())
      } else if (isOp('/')) {
        p++
        left = div(left, unary())
      } else if (startsPrimary()) {
        left = mul(left, power()) // implicit multiplication: 2x, 3(x+1), (x+1)(x-2)
      } else {
        return left
      }
    }
  }

  const unary = (): Node => {
    if (isOp('-')) {
      p++
      return neg(unary())
    }
    if (isOp('+')) {
      p++
      return unary()
    }
    return power()
  }

  const power = (): Node => {
    const base = primary()
    if (isOp('^')) {
      p++
      return pow(base, unary())
    }
    return base
  }

  const primary = (): Node => {
    const t = toks[p++]
    if (!t) throw new ParseError('The expression ends too early')
    if (t.k === 'num') return num(Rat.parse(t.s))
    if (t.k === 'id') {
      if (t.s === 'sqrt') {
        if (!isOp('(')) throw new ParseError('Write sqrt with brackets, like sqrt(9)')
        p++
        const inner = expr()
        if (!isOp(')')) throw new ParseError('Missing closing bracket')
        p++
        return sqrt(inner)
      }
      return sym(t.s)
    }
    if (t.s === '(') {
      const inner = expr()
      if (!isOp(')')) throw new ParseError('Missing closing bracket')
      p++
      return inner
    }
    throw new ParseError(`Unexpected "${t.s}"`)
  }

  if (toks.length === 0) throw new ParseError('Empty expression')
  const out = expr()
  if (p < toks.length) throw new ParseError(`Unexpected "${toks[p].s}"`)
  return out
}

/* --------------------------------- Printers -------------------------------- */

const PREC = { add: 1, neg: 2, mul: 3, div: 3, pow: 4, atom: 5 } as const
function prec(n: Node): number {
  switch (n.t) {
    case 'add':
      return PREC.add
    case 'neg':
      return PREC.neg
    case 'mul':
      return PREC.mul
    case 'div':
      return PREC.div
    case 'pow':
      return PREC.pow
    case 'num':
      return n.v.isNeg() ? PREC.neg : n.v.isInt() ? PREC.atom : PREC.div
    default:
      return PREC.atom
  }
}

/** Plain text, re-parseable by `parseExpr`. */
export function toText(n: Node): string {
  const wrap = (c: Node, min: number) => (prec(c) < min ? `(${toText(c)})` : toText(c))
  switch (n.t) {
    case 'num':
      return n.v.toString()
    case 'var':
      return n.name
    case 'add':
      return n.a
        .map((c, i) => {
          if (c.t === 'neg') return (i ? ' - ' : '-') + wrap(c.x, PREC.mul)
          if (c.t === 'num' && c.v.isNeg()) return (i ? ' - ' : '-') + toText(num(c.v.neg()))
          return (i ? ' + ' : '') + wrap(c, PREC.add + 1)
        })
        .join('')
    case 'neg':
      return '-' + wrap(n.x, PREC.mul)
    case 'mul':
      return n.a
        .map((c, i) => {
          const s = wrap(c, PREC.mul + (c.t === 'div' ? 1 : 0))
          if (i === 0) return s
          const prev = n.a[i - 1]
          const needsStar = c.t === 'num' || (prev.t === 'num' && /^[0-9]/.test(s)) || prev.t === 'div'
          return (needsStar ? '*' : '') + s
        })
        .join('')
    case 'div':
      return `${wrap(n.n, PREC.mul)}/${wrap(n.d, PREC.pow)}`
    case 'pow':
      return `${wrap(n.b, PREC.atom)}^${wrap(n.e, PREC.atom)}`
    case 'sqrt':
      return `sqrt(${toText(n.x)})`
  }
}

/** LaTeX for KaTeX. */
export function toTex(n: Node): string {
  const wrap = (c: Node, min: number) => (prec(c) < min ? `\\left(${toTex(c)}\\right)` : toTex(c))
  switch (n.t) {
    case 'num':
      if (n.v.isInt()) return n.v.toString()
      return `${n.v.isNeg() ? '-' : ''}\\frac{${n.v.abs().n}}{${n.v.d}}`
    case 'var':
      return n.name
    case 'add':
      return n.a
        .map((c, i) => {
          if (c.t === 'neg') return (i ? ' - ' : '-') + wrap(c.x, PREC.mul)
          if (c.t === 'num' && c.v.isNeg()) return (i ? ' - ' : '-') + toTex(num(c.v.neg()))
          return (i ? ' + ' : '') + wrap(c, PREC.add + 1)
        })
        .join('')
    case 'neg':
      return '-' + wrap(n.x, PREC.mul)
    case 'mul':
      return n.a
        .map((c, i) => {
          const s = wrap(c, PREC.mul)
          if (i === 0) return s
          const prev = n.a[i - 1]
          const numeric = c.t === 'num' || (c.t === 'pow' && c.b.t === 'num')
          return (numeric || (prev.t === 'num' && c.t === 'div') ? ' \\cdot ' : '') + s
        })
        .join('')
    case 'div':
      return `\\frac{${toTex(n.n)}}{${toTex(n.d)}}`
    case 'pow':
      return `${wrap(n.b, PREC.atom)}^{${toTex(n.e)}}`
    case 'sqrt':
      return `\\sqrt{${toTex(n.x)}}`
  }
}
