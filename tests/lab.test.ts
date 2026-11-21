import { describe, expect, it } from 'vitest'
import { analyze } from '../src/engine/analyze'
import { MARKING_CASES, tutorCases } from '../src/lab/cases'

describe('AI check cases', () => {
  it('has hand labels the engine agrees with, for every marking case', () => {
    expect(MARKING_CASES.length).toBe(24)
    for (const c of MARKING_CASES) {
      const a = analyze(c.lines)
      expect(a.steps.some((s) => s.status === 'unreadable'), c.id).toBe(false)
      expect(a.faultIndex === null ? 0 : a.faultIndex + 1, c.id).toBe(c.firstWrong)
    }
  })

  it('gives the tutor only working that really has a mistake', () => {
    const cases = tutorCases()
    expect(cases.length).toBe(37)
    for (const c of cases) expect(analyze(c.lines).faultIndex, c.id).not.toBeNull()
  })

  it('builds the same tutor cases every time', () => {
    expect(tutorCases()).toEqual(tutorCases())
  })
})
