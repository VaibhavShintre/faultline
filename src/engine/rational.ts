/** Exact rational numbers on BigInt. Always stored in lowest terms with a positive denominator. */
export class Rat {
  readonly n: bigint
  readonly d: bigint

  constructor(n: bigint, d: bigint = 1n) {
    if (d === 0n) throw new Error('Division by zero')
    if (d < 0n) {
      n = -n
      d = -d
    }
    const g = gcd(n < 0n ? -n : n, d)
    this.n = g === 0n ? 0n : n / g
    this.d = g === 0n ? 1n : d / g
  }

  static of(x: number | bigint): Rat {
    if (typeof x === 'bigint') return new Rat(x)
    if (!Number.isInteger(x)) throw new Error('Rat.of needs an integer')
    return new Rat(BigInt(x))
  }

  /** Parses "12", "3.75", ".5". */
  static parse(s: string): Rat {
    const [whole, frac = ''] = s.split('.')
    const digits = (whole || '0') + frac
    return new Rat(BigInt(digits), 10n ** BigInt(frac.length))
  }

  add(o: Rat): Rat {
    return new Rat(this.n * o.d + o.n * this.d, this.d * o.d)
  }
  sub(o: Rat): Rat {
    return new Rat(this.n * o.d - o.n * this.d, this.d * o.d)
  }
  mul(o: Rat): Rat {
    return new Rat(this.n * o.n, this.d * o.d)
  }
  div(o: Rat): Rat {
    if (o.n === 0n) throw new Error('Division by zero')
    return new Rat(this.n * o.d, this.d * o.n)
  }
  neg(): Rat {
    return new Rat(-this.n, this.d)
  }
  abs(): Rat {
    return this.n < 0n ? this.neg() : this
  }
  pow(e: number): Rat {
    if (!Number.isInteger(e)) throw new Error('Integer exponents only')
    if (e < 0) return new Rat(this.d, this.n).pow(-e)
    return new Rat(this.n ** BigInt(e), this.d ** BigInt(e))
  }
  eq(o: Rat): boolean {
    return this.n === o.n && this.d === o.d
  }
  isZero(): boolean {
    return this.n === 0n
  }
  isOne(): boolean {
    return this.n === 1n && this.d === 1n
  }
  isInt(): boolean {
    return this.d === 1n
  }
  isNeg(): boolean {
    return this.n < 0n
  }
  toNumber(): number {
    return Number(this.n) / Number(this.d)
  }
  toString(): string {
    return this.d === 1n ? `${this.n}` : `${this.n}/${this.d}`
  }
}

function gcd(a: bigint, b: bigint): bigint {
  while (b !== 0n) {
    ;[a, b] = [b, a % b]
  }
  return a
}

export const ZERO = Rat.of(0)
export const ONE = Rat.of(1)
