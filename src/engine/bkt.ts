import type { MisconceptionId } from './malrules'

/**
 * Bayesian Knowledge Tracing: a hidden-Markov model of whether a student has learned a skill.
 * Here each skill is "does NOT make misconception X". An observed fault with that
 * misconception is an incorrect response; a clean targeted practice problem is a correct one.
 */
export const BKT = { prior: 0.5, learn: 0.15, guess: 0.2, slip: 0.1 }

export interface SkillState {
  /** Probability the student has mastered the skill. */
  p: number
  errors: number
  fixes: number
  lastSeen: number
}

export type Mastery = Partial<Record<MisconceptionId, SkillState>>

export function observe(prev: SkillState | undefined, correct: boolean, now = Date.now()): SkillState {
  const s = prev ?? { p: BKT.prior, errors: 0, fixes: 0, lastSeen: now }
  const { guess, slip, learn } = BKT
  const posterior = correct
    ? (s.p * (1 - slip)) / (s.p * (1 - slip) + (1 - s.p) * guess)
    : (s.p * slip) / (s.p * slip + (1 - s.p) * (1 - guess))
  return {
    p: posterior + (1 - posterior) * learn,
    errors: s.errors + (correct ? 0 : 1),
    fixes: s.fixes + (correct ? 1 : 0),
    lastSeen: now,
  }
}

export const MASTERED = 0.9

export function level(p: number): 'fragile' | 'shaky' | 'steady' | 'solid' {
  if (p >= MASTERED) return 'solid'
  if (p >= 0.65) return 'steady'
  if (p >= 0.35) return 'shaky'
  return 'fragile'
}

const KEY = 'faultline.mastery.v1'

export function loadMastery(): Mastery {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? '{}') as Mastery
  } catch {
    return {}
  }
}

export function saveMastery(m: Mastery): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(m))
  } catch {
    /* private mode: mastery lasts for this visit only */
  }
}
