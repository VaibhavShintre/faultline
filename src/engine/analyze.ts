import { ParseError } from './ast'
import { type Counterexample, type Line, counterexample, lineToTex, parseLine, sameLine } from './line'
import { type Diagnosis, diagnose } from './malrules'

/**
 * start        the given problem
 * ok           follows from the line above, and the working is still correct
 * fault        the first line that does not follow: the fault line
 * carried      follows correctly from the line above, but the line above is already wrong
 * second-fault a new, separate mistake made after the fault line
 * recovered    agrees with the last correct line again, so the working is back on track
 * unreadable   could not be parsed
 * blank        empty row
 */
export type StepStatus = 'start' | 'ok' | 'fault' | 'carried' | 'second-fault' | 'recovered' | 'unreadable' | 'blank'

export interface Step {
  index: number
  raw: string
  status: StepStatus
  tex?: string
  line?: Line
  /** Parse problem, for unreadable lines. */
  problem?: string
  /** For fault and second-fault steps: what went wrong, relative to `against`. */
  diagnosis?: Diagnosis
  counterexample?: Counterexample | null
  /** Index of the line this step was compared with. */
  against?: number
}

export interface Analysis {
  steps: Step[]
  /** Index into `steps` of the first invalid step, or null when every step follows. */
  faultIndex: number | null
  /** Indices of every step that is a mistake in its own right: the fault line, then any second faults. */
  faults: number[]
  /** True when at least two readable lines were checked and all of them follow. */
  clean: boolean
}

/**
 * Checks a student's working line by line.
 *
 * Every line is compared with the line directly above it. Once a line has gone wrong,
 * the lines after it are still checked: a line that follows correctly from the wrong line
 * is marked as carrying the mistake forward (the method is fine, the input was wrong),
 * a line that does not follow is a second, separate mistake with its own diagnosis,
 * and a line that agrees with the last correct line again puts the working back on track.
 */
export function analyze(rawLines: string[]): Analysis {
  const steps: Step[] = []
  let good: { line: Line; index: number } | null = null // last line known to be correct
  let prev: { line: Line; index: number } | null = null // last readable line
  let onTrack = true
  let checked = 0
  const faults: number[] = []

  rawLines.forEach((raw, index) => {
    if (!raw.trim()) {
      steps.push({ index, raw, status: 'blank' })
      return
    }
    let line: Line
    try {
      line = parseLine(raw)
    } catch (e) {
      const problem = e instanceof ParseError ? e.message : 'This line could not be read'
      steps.push({ index, raw, status: 'unreadable', problem })
      return
    }
    const step: Step = { index, raw, status: 'start', line, tex: lineToTex(line) }
    if (good === null || prev === null) {
      good = prev = { line, index }
      steps.push(step)
      return
    }
    if (prev.line.kind !== line.kind) {
      step.status = 'unreadable'
      step.problem =
        prev.line.kind === 'eq' ? 'This line has no equals sign, but the line above is an equation' : 'This line is an equation, but the line above is an expression'
      steps.push(step)
      return
    }

    step.against = prev.index
    if (onTrack) {
      if (sameLine(prev.line, line)) {
        step.status = 'ok'
        checked++
      } else {
        // Going wrong again after getting back on track is a further mistake, not a new fault line.
        step.status = faults.length ? 'second-fault' : 'fault'
        onTrack = false
      }
    } else if (sameLine(good.line, line)) {
      step.status = 'recovered'
      step.against = good.index
      onTrack = true
    } else if (sameLine(prev.line, line)) {
      step.status = 'carried'
    } else {
      step.status = 'second-fault'
    }

    if (step.status === 'fault' || step.status === 'second-fault') {
      step.diagnosis = diagnose(prev.line, line)
      step.counterexample = counterexample(prev.line, line)
      faults.push(index)
    }
    prev = { line, index }
    if (onTrack) good = prev
    steps.push(step)
  })

  return { steps, faultIndex: faults.length ? faults[0] : null, faults, clean: faults.length === 0 && checked > 0 }
}
