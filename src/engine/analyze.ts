import { ParseError } from './ast'
import { type Counterexample, type Line, counterexample, lineToTex, parseLine, sameLine } from './line'
import { type Diagnosis, diagnose } from './malrules'

export type StepStatus = 'start' | 'ok' | 'fault' | 'after-fault' | 'unreadable' | 'blank'

export interface Step {
  index: number
  raw: string
  status: StepStatus
  tex?: string
  line?: Line
  /** Parse problem, for unreadable lines. */
  problem?: string
  diagnosis?: Diagnosis
  counterexample?: Counterexample | null
}

export interface Analysis {
  steps: Step[]
  /** Index into `steps` of the first invalid step, or null when every step follows. */
  faultIndex: number | null
  /** True when at least two readable lines were checked and all of them follow. */
  clean: boolean
}

/**
 * Checks a student's working line by line.
 * Each line is compared with the last line known to be correct, so one early mistake
 * does not make every later line look wrong: lines after the fault are checked against
 * the faulty line and reported as "consistent with your mistake" or not.
 */
export function analyze(rawLines: string[]): Analysis {
  const steps: Step[] = []
  let anchor: Line | null = null // last line everything is compared against
  let faultIndex: number | null = null
  let checked = 0

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
    if (anchor === null) {
      anchor = line
    } else if (anchor.kind !== line.kind) {
      step.status = 'unreadable'
      step.problem =
        anchor.kind === 'eq' ? 'This line has no equals sign, but the line above is an equation' : 'This line is an equation, but the line above is an expression'
    } else if (faultIndex !== null) {
      step.status = 'after-fault'
    } else if (sameLine(anchor, line)) {
      step.status = 'ok'
      anchor = line
      checked++
    } else {
      step.status = 'fault'
      step.diagnosis = diagnose(anchor, line)
      step.counterexample = counterexample(anchor, line)
      faultIndex = steps.length
    }
    steps.push(step)
  })

  return { steps, faultIndex, clean: faultIndex === null && checked > 0 }
}
