import { describe, expect, it } from 'vitest'
import { analyze } from '../src/engine/analyze'
import { counterexample, nice, parseLine, solutionsOf } from '../src/engine/line'

const statuses = (...lines: string[]) => analyze(lines).steps.map((s) => s.status)

describe('lines after the fault line', () => {
  it('marks lines that follow from the wrong line as carried forward', () => {
    expect(statuses('12 - (x - 4) = 9', '12 - x - 4 = 9', '8 - x = 9', 'x = -1')).toEqual(['start', 'fault', 'carried', 'carried'])
  })

  it('finds a second, separate mistake and diagnoses it against the line above', () => {
    const a = analyze(['5(x + 2) - 3 = 2x + 19', '5x + 2 - 3 = 2x + 19', '5x - 1 = 2x + 19', '7x - 1 = 19', '7x = 20', 'x = 20/7'])
    expect(a.steps.map((s) => s.status)).toEqual(['start', 'fault', 'carried', 'second-fault', 'carried', 'carried'])
    expect(a.faultIndex).toBe(1)
    expect(a.faults).toEqual([1, 3])
    expect(a.steps[1].diagnosis?.id).toBe('distribute-partial')
    expect(a.steps[3].diagnosis?.id).toBe('move-sign')
    expect(a.steps[3].against).toBe(2)
    expect(a.clean).toBe(false)
  })

  it('notices when the working comes back on track', () => {
    const a = analyze(['2(x + 3) = 14', '2x + 3 = 14', '2x + 6 = 14', '2x = 8', 'x = 4'])
    expect(a.steps.map((s) => s.status)).toEqual(['start', 'fault', 'recovered', 'ok', 'ok'])
    expect(a.faults).toEqual([1])
  })

  it('can go wrong again after recovering', () => {
    const a = analyze(['2(x + 3) = 14', '2x + 3 = 14', '2x + 6 = 14', '2x = 20', 'x = 10'])
    expect(a.steps.map((s) => s.status)).toEqual(['start', 'fault', 'recovered', 'second-fault', 'carried'])
    expect(a.faults).toEqual([1, 3])
    expect(a.steps[3].diagnosis?.id).toBe('move-sign')
  })

  it('works for expressions as well as equations', () => {
    expect(statuses('(x + 5)^2 - x^2', 'x^2 + 25 - x^2', '25')).toEqual(['start', 'fault', 'carried'])
  })

  it('skips unreadable and blank lines without losing its place', () => {
    expect(statuses('3(x - 2) = 9', '3x - 2 = 9', '', '3x = = 11', '3x = 11')).toEqual(['start', 'fault', 'blank', 'unreadable', 'carried'])
  })
})

describe('number check', () => {
  it('uses a value that does not give the answer away when one exists', () => {
    const [prev, cur] = [parseLine('3(x - 2) + 4 = 19'), parseLine('3x - 2 + 4 = 19')]
    const cx = counterexample(prev, cur)!
    expect(cx.revealsSolution).toBe(false)
    expect(cx.atText).toBe('x = 17/3')
    expect(cx.prevSays).toBe('the line above is false (15 ≠ 19)')
    expect(cx.curSays).toBe('your line is true (19 = 19)')
    // The true solution is 7 and it is not the check point.
    const sol = solutionsOf(prev as typeof prev & { kind: 'eq' })
    expect(sol.type === 'roots' && sol.roots[0][0]).toBe(7)
    expect(cx.at.x).not.toBe(7)
  })

  it('falls back to the lost solution when nothing else separates the lines', () => {
    const cx = counterexample(parseLine('x^2 = 49'), parseLine('x = 7'))!
    expect(cx.revealsSolution).toBe(true)
    expect(cx.atText).toBe('x = -7')
  })

  it('writes values the way a student would', () => {
    expect(nice(7)).toBe('7')
    expect(nice(17 / 3)).toBe('17/3')
    expect(nice(-0.5)).toBe('-1/2')
    expect(nice(Math.SQRT2)).toBe('1.414')
  })
})
