/**
 * Fixed test sets for checking the AI in Faultline. Nothing here is random at run time,
 * so anyone can repeat the checks on their own device and compare.
 */
import { EXAMPLES } from '../examples'
import type { MisconceptionId } from '../engine/malrules'
import { hasTargetedPractice, makeProblem, seeded } from '../engine/practice'
import { CATALOG } from '../engine/catalog'

export interface MarkingCase {
  id: string
  lines: string[]
  /** 1-based number of the first line that does not follow, or 0 when the working is correct. Set by hand. */
  firstWrong: number
}

/**
 * Twelve problems, each written out once correctly and once with a single planted mistake.
 * The labels were worked out by hand; a unit test confirms the engine agrees with every one.
 */
const PAIRS: { right: string[]; wrong: string[]; firstWrong: number }[] = [
  {
    right: ['3(x - 2) + 4 = 19', '3x - 6 + 4 = 19', '3x - 2 = 19', '3x = 21', 'x = 7'],
    wrong: ['3(x - 2) + 4 = 19', '3x - 6 + 4 = 19', '3x - 2 = 19', '3x = 17', 'x = 17/3'],
    firstWrong: 4,
  },
  {
    right: ['2(x + 5) = 3x - 4', '2x + 10 = 3x - 4', '10 = x - 4', 'x = 14'],
    wrong: ['2(x + 5) = 3x - 4', '2x + 5 = 3x - 4', '5 = x - 4', 'x = 9'],
    firstWrong: 2,
  },
  { right: ['x/3 + 2 = 6', 'x/3 = 4', 'x = 12'], wrong: ['x/3 + 2 = 6', 'x/3 = 4', 'x = 4/3'], firstWrong: 3 },
  { right: ['4x - 7 = 2x + 9', '2x - 7 = 9', '2x = 16', 'x = 8'], wrong: ['4x - 7 = 2x + 9', '2x - 7 = 9', '2x = 2', 'x = 1'], firstWrong: 3 },
  { right: ['x^2 - 9 = 40', 'x^2 = 49', 'x = 7 or x = -7'], wrong: ['x^2 - 9 = 40', 'x^2 = 49', 'x = 7'], firstWrong: 3 },
  {
    right: ['12 - (x - 4) = 9', '12 - x + 4 = 9', '16 - x = 9', 'x = 7'],
    wrong: ['12 - (x - 4) = 9', '12 - x + 4 = 9', '16 - x = 9', 'x = -7'],
    firstWrong: 4,
  },
  {
    right: ['5x + 3 = 2x + 18', '3x + 3 = 18', '3x = 15', 'x = 5'],
    wrong: ['5x + 3 = 2x + 18', '7x + 3 = 18', '7x = 15', 'x = 15/7'],
    firstWrong: 2,
  },
  { right: ['2x/5 = 6', '2x = 30', 'x = 15'], wrong: ['2x/5 = 6', '2x = 30', 'x = 60'], firstWrong: 3 },
  {
    right: ['3(2x - 1) = 4x + 9', '6x - 3 = 4x + 9', '2x - 3 = 9', '2x = 12', 'x = 6'],
    wrong: ['3(2x - 1) = 4x + 9', '6x - 3 = 4x + 9', '2x - 3 = 9', '2x = 6', 'x = 3'],
    firstWrong: 4,
  },
  {
    right: ['x^2 - 5x + 6 = 0', '(x - 2)(x - 3) = 0', 'x = 2 or x = 3'],
    wrong: ['x^2 - 5x + 6 = 0', '(x - 2)(x - 3) = 0', 'x = -2 or x = -3'],
    firstWrong: 3,
  },
  { right: ['(2x + 6)/2 = 7', 'x + 3 = 7', 'x = 4'], wrong: ['(2x + 6)/2 = 7', 'x + 6 = 7', 'x = 1'], firstWrong: 2 },
  {
    right: ['7 - 2(x + 1) = 1', '7 - 2x - 2 = 1', '5 - 2x = 1', '-2x = -4', 'x = 2'],
    wrong: ['7 - 2(x + 1) = 1', '7 - 2x + 2 = 1', '9 - 2x = 1', '-2x = -8', 'x = 4'],
    firstWrong: 2,
  },
]

export const MARKING_CASES: MarkingCase[] = PAIRS.flatMap((p, i) => [
  { id: `P${i + 1}-right`, lines: p.right, firstWrong: 0 },
  { id: `P${i + 1}-wrong`, lines: p.wrong, firstWrong: p.firstWrong },
])

export interface TutorCase {
  id: string
  label: string
  lines: string[]
}

/**
 * Faulty working for the tutor to explain: two generated problems for every misconception
 * that has a practice generator (the tempting wrong step is the second line), plus the
 * worked examples from the Check page.
 */
export function tutorCases(): TutorCase[] {
  const skills = (Object.keys(CATALOG) as MisconceptionId[]).filter(hasTargetedPractice)
  const generated = skills.flatMap((skill, i) =>
    [101, 202].map((seed, j) => {
      const p = makeProblem(skill, seeded(seed + i))
      return { id: `${skill}-${j + 1}`, label: CATALOG[skill].name, lines: [p.start, p.trap] }
    }),
  )
  const examples = EXAMPLES.filter((e) => e.title !== 'All correct').map((e) => ({ id: `example-${e.title.toLowerCase().replace(/\s+/g, '-')}`, label: `Example: ${e.title}`, lines: e.lines }))
  return [...generated, ...examples]
}
