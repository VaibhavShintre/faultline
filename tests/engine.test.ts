import { describe, expect, it } from 'vitest'
import { parseExpr, toText, toTex } from '../src/engine/ast'
import { analyze } from '../src/engine/analyze'
import { compareSolutions, parseLine, sameLine, solutionsOf } from '../src/engine/line'

const eq = (s: string) => parseLine(s) as ReturnType<typeof parseLine> & { kind: 'eq' }
const fault = (...lines: string[]) => {
  const a = analyze(lines)
  return a.faultIndex === null ? null : a.steps[a.faultIndex]
}
const idOf = (...lines: string[]) => fault(...lines)?.diagnosis?.id ?? 'no-fault'

describe('parser and printers', () => {
  it('round-trips through text', () => {
    for (const s of ['2x + 3', '-(x - 3)^2', '3(x+1)(x-2)', 'x^2 - 5x + 6', '(2x+6)/2', '1/2x + 3', '2*3 - -4', 'sqrt(9) + x²']) {
      const n = parseExpr(s)
      expect(sameLine({ kind: 'expr', node: n }, { kind: 'expr', node: parseExpr(toText(n)) })).toBe(true)
    }
  })
  it('prints tex', () => {
    expect(toTex(parseExpr('(2x+6)/2'))).toBe('\\frac{2x + 6}{2}')
    expect(toTex(parseExpr('x^2 - 5x + 6'))).toBe('x^{2} - 5x + 6')
  })
  it('reads solution lists', () => {
    expect(eq('x = 3 or x = -2').parts.length).toBe(2)
    expect(eq('x = 3, -2').parts.length).toBe(2)
    expect(eq('x = ±3').parts.length).toBe(2)
    expect(eq('no solution').parts.length).toBe(0)
  })
})

describe('equivalence', () => {
  it('accepts valid steps', () => {
    const ok: [string, string][] = [
      ['2(x+3) = 10', '2x + 6 = 10'],
      ['2x + 6 = 10', 'x = 2'],
      ['x^2 - 5x + 6 = 0', '(x-2)(x-3) = 0'],
      ['(x-2)(x-3) = 0', 'x = 2 or x = 3'],
      ['x^2 = 9', 'x = ±3'],
      ['x^2 = 5', 'x = sqrt(5) or x = -sqrt(5)'],
      ['x^2 = 8', 'x = ±2sqrt(2)'],
      ['x/2 + 3 = 5', 'x + 6 = 10'],
      ['(x+3)^2 - x^2', '6x + 9'],
      ['2x + 2y = 4', 'x + y = 2'],
      ['x + 1 = x + 2', 'no solution'],
    ]
    for (const [a, b] of ok) expect(sameLine(parseLine(a), parseLine(b)), `${a} -> ${b}`).toBe(true)
  })
  it('rejects invalid steps', () => {
    const bad: [string, string][] = [
      ['2(x+3) = 10', '2x + 3 = 10'],
      ['x^2 = 9', 'x = 3'],
      ['(x+3)^2', 'x^2 + 9'],
      ['2x = 8', 'x = 6'],
    ]
    for (const [a, b] of bad) expect(sameLine(parseLine(a), parseLine(b)), `${a} -> ${b}`).toBe(false)
  })
  it('finds roots', () => {
    const s = solutionsOf(eq('x^2 - 5x + 6 = 0'))
    expect(s.type === 'roots' && s.roots.map((r) => r[0])).toEqual([2, 3])
    expect(compareSolutions(eq('x^2 = 9'), eq('x = 3'))).toBe('lost')
    expect(compareSolutions(eq('x = 3'), eq('x^2 = 9'))).toBe('extra')
  })
})

describe('diagnosis', () => {
  const cases: [string, string[]][] = [
    ['distribute-partial', ['2(x+3) = 10', '2x + 3 = 10']],
    ['distribute-partial', ['3(x+2) - 4 = 11', '3x + 2 = 15']],
    ['negative-distribution', ['5 - (x - 3) = 10', '5 - x - 3 = 10']],
    ['negative-distribution', ['7 - 2(x - 3) = 1', '7 - 2x - 6 = 1']],
    ['power-over-sum', ['(x+3)^2', 'x^2 + 9']],
    ['power-over-sum', ['(x-4)^2 = 0', 'x^2 - 16 = 0']],
    ['exponent-rules', ['x^2 * x^3', 'x^6']],
    ['exponent-rules', ['(x^2)^3', 'x^5']],
    ['unlike-terms', ['2x + 3 = 10', '5x = 10']],
    ['unlike-terms', ['x^2 + x', 'x^3']],
    ['fraction-add', ['1/2 + 1/3', '2/5']],
    ['cancel-across-sum', ['(2x+6)/2 = 5', 'x + 6 = 5']],
    ['cancel-across-sum', ['(x+3)/x', '3']],
    ['move-sign', ['2x + 3 = 11', '2x = 14']],
    ['move-sign', ['3x = x + 8', '4x = 8']],
    ['divide-every-term', ['2x + 6 = 10', 'x + 6 = 5']],
    ['multiply-every-term', ['x/2 + 3 = 5', 'x + 3 = 10']],
    ['inverse-operation', ['3x = 12', 'x = 9']],
    ['inverse-operation', ['x + 4 = 12', 'x = 3']],
    ['zero-product', ['(x-2)(x+3) = 6', 'x - 2 = 6 or x + 3 = 6']],
    ['forgot-plus-minus', ['x^2 = 9', 'x = 3']],
    ['root-sign', ['(x-2)(x+3) = 0', 'x = -2 or x = 3']],
    ['lost-solution', ['x^2 = 3x', 'x = 3']],
    ['sign-slip', ['x^2 - 5x + 6 = 0', '(x+2)(x-3) = 0']],
    ['arithmetic-slip', ['7x = 56', 'x = 9']],
    ['arithmetic-slip', ['3(x+4) = 20', '3x + 14 = 20']],
  ]
  for (const [id, lines] of cases) it(`${lines.join('  ->  ')}  is ${id}`, () => expect(idOf(...lines)).toBe(id))

  it('pinpoints the first wrong line and keeps going', () => {
    const a = analyze(['3(x - 2) + 4 = 19', '3x - 2 + 4 = 19', '3x + 2 = 19', '3x = 17', 'x = 17/3'])
    expect(a.faultIndex).toBe(1)
    expect(a.steps.map((s) => s.status)).toEqual(['start', 'fault', 'after-fault', 'after-fault', 'after-fault'])
    expect(a.steps[1].diagnosis?.id).toBe('distribute-partial')
    expect(a.steps[1].diagnosis?.right).toBe('3x - 6')
    expect(a.steps[1].counterexample).toBeTruthy()
  })
  it('passes clean working', () => {
    const a = analyze(['3(x - 2) + 4 = 19', '3x - 6 + 4 = 19', '3x - 2 = 19', '3x = 21', 'x = 7'])
    expect(a.clean).toBe(true)
  })
  it('reports unreadable lines without crashing', () => {
    const a = analyze(['2x + = 4', '', 'x = 2'])
    expect(a.steps[0].status).toBe('unreadable')
    expect(a.steps[1].status).toBe('blank')
  })
})

import { BKT, observe } from '../src/engine/bkt'
import { CATALOG, explain } from '../src/engine/catalog'
import { hasTargetedPractice, isFinished, makeProblem, seeded } from '../src/engine/practice'
import type { MisconceptionId } from '../src/engine/malrules'

describe('practice generators', () => {
  const skills = (Object.keys(CATALOG) as MisconceptionId[]).filter(hasTargetedPractice)
  for (const skill of skills)
    it(`${skill}: every generated problem provokes exactly that misconception`, () => {
      const r = seeded(7)
      for (let i = 0; i < 25; i++) {
        const p = makeProblem(skill, r)
        expect(idOf(p.start, p.trap), `${p.start} -> ${p.trap}`).toBe(skill)
      }
    })
  it('knows when the work is finished', () => {
    expect(isFinished('solve', parseLine('x = 3 or x = -2'))).toBe(true)
    expect(isFinished('solve', parseLine('2x = 6'))).toBe(false)
    expect(isFinished('simplify', parseLine('x^2 + 6x + 9'))).toBe(true)
    expect(isFinished('simplify', parseLine('(x+3)(x+3)'))).toBe(false)
    expect(isFinished('simplify', parseLine('x^2 + 3x + 3x + 9'))).toBe(false)
    expect(isFinished('simplify', parseLine('5/6'))).toBe(true)
    expect(isFinished('simplify', parseLine('x + 3'))).toBe(true)
  })
})

describe('knowledge tracing', () => {
  it('falls after an error and recovers with correct practice', () => {
    const afterError = observe(undefined, false)
    expect(afterError.p).toBeLessThan(BKT.prior)
    let s = afterError
    for (let i = 0; i < 4; i++) s = observe(s, true)
    expect(s.p).toBeGreaterThan(0.9)
    expect(s.errors).toBe(1)
    expect(s.fixes).toBe(4)
  })
  it('explains every diagnosis', () => {
    for (const id of Object.keys(CATALOG) as MisconceptionId[]) expect(explain({ id, from: 'a', wrong: 'b', right: 'c' }).length).toBeGreaterThan(20)
  })
})
