import type { Diagnosis, MisconceptionId } from './malrules'

export interface Misconception {
  id: MisconceptionId
  name: string
  /** Topic group, used to lay out the misconception map. */
  family: 'Brackets' | 'Powers' | 'Terms and fractions' | 'Balancing equations' | 'Solution sets' | 'Slips'
  /** The rule that was broken, stated positively. */
  principle: string
  /** One-line description of the wrong idea. */
  belief: string
}

export const CATALOG: Record<MisconceptionId, Misconception> = {
  'distribute-partial': {
    id: 'distribute-partial',
    name: 'Partial distribution',
    family: 'Brackets',
    principle: 'The multiplier outside a bracket multiplies every term inside it.',
    belief: 'Only the first term in the bracket gets multiplied.',
  },
  'negative-distribution': {
    id: 'negative-distribution',
    name: 'Lost negative',
    family: 'Brackets',
    principle: 'A minus in front of a bracket flips the sign of every term inside it.',
    belief: 'The minus sign only affects the first term in the bracket.',
  },
  'power-over-sum': {
    id: 'power-over-sum',
    name: 'Power over a sum',
    family: 'Powers',
    principle: '(a + b)² means (a + b)(a + b), which gives a² + 2ab + b². The middle term is real.',
    belief: 'A power can be handed to each term of a sum separately.',
  },
  'exponent-rules': {
    id: 'exponent-rules',
    name: 'Exponent rule mix-up',
    family: 'Powers',
    principle: 'Multiplying powers of the same base adds the exponents. A power of a power multiplies them.',
    belief: 'The add rule and the multiply rule for exponents are swapped.',
  },
  'unlike-terms': {
    id: 'unlike-terms',
    name: 'Combining unlike terms',
    family: 'Terms and fractions',
    principle: 'Only terms with exactly the same variable part can be added together.',
    belief: 'Any two terms can be merged by adding their numbers.',
  },
  'fraction-add': {
    id: 'fraction-add',
    name: 'Adding fractions straight across',
    family: 'Terms and fractions',
    principle: 'Fractions need a common denominator before their numerators are added.',
    belief: 'Fractions add like they multiply: top with top, bottom with bottom.',
  },
  'cancel-across-sum': {
    id: 'cancel-across-sum',
    name: 'Cancelling inside a sum',
    family: 'Terms and fractions',
    principle: 'You can only cancel a factor of the whole numerator, so every term on top must be divided.',
    belief: 'A number on the bottom can cancel with just one term on top.',
  },
  'move-sign': {
    id: 'move-sign',
    name: 'Moved without changing sign',
    family: 'Balancing equations',
    principle: 'A term crosses the equals sign by doing the opposite operation to both sides, so its sign flips.',
    belief: 'Terms can slide across the equals sign unchanged.',
  },
  'divide-every-term': {
    id: 'divide-every-term',
    name: 'Divided only part of the equation',
    family: 'Balancing equations',
    principle: 'Dividing an equation by a number divides every term on both sides.',
    belief: 'Dividing only has to touch the term with the variable.',
  },
  'multiply-every-term': {
    id: 'multiply-every-term',
    name: 'Multiplied only part of the equation',
    family: 'Balancing equations',
    principle: 'Clearing a fraction multiplies every term on both sides.',
    belief: 'Multiplying only has to touch the fraction and the other side.',
  },
  'inverse-operation': {
    id: 'inverse-operation',
    name: 'Wrong inverse operation',
    family: 'Balancing equations',
    principle: 'Undo multiplication with division, and undo addition with subtraction.',
    belief: 'Any operation with the same number will remove it.',
  },
  'zero-product': {
    id: 'zero-product',
    name: 'Zero-product rule without a zero',
    family: 'Solution sets',
    principle: 'Factors can be set equal to zero one at a time only when the product equals zero.',
    belief: 'If a product equals 6, each factor can be set equal to 6.',
  },
  'forgot-plus-minus': {
    id: 'forgot-plus-minus',
    name: 'Forgot the ± root',
    family: 'Solution sets',
    principle: 'Taking a square root in an equation gives two answers: the positive and the negative root.',
    belief: 'A square root has only the positive answer.',
  },
  'root-sign': {
    id: 'root-sign',
    name: 'Roots read with the wrong sign',
    family: 'Solution sets',
    principle: 'A factor (x − a) is zero when x = a, so the root has the opposite sign to the number in the bracket.',
    belief: 'The number inside the bracket is the root.',
  },
  'lost-solution': {
    id: 'lost-solution',
    name: 'Lost a solution',
    family: 'Solution sets',
    principle: 'Dividing both sides by an expression that could be zero throws away a solution. Factor instead.',
    belief: 'It is always safe to divide both sides by x.',
  },
  'extraneous-solution': {
    id: 'extraneous-solution',
    name: 'Picked up an extra solution',
    family: 'Solution sets',
    principle: 'Squaring both sides or multiplying by a variable can add answers that do not fit the original equation.',
    belief: 'Every answer of the new equation also solves the old one.',
  },
  'sign-slip': {
    id: 'sign-slip',
    name: 'Sign slip',
    family: 'Slips',
    principle: 'Track the sign of every term as it is copied to the next line.',
    belief: 'This looks like a slip, not a wrong rule.',
  },
  'arithmetic-slip': {
    id: 'arithmetic-slip',
    name: 'Arithmetic slip',
    family: 'Slips',
    principle: 'The method is right. One number was calculated wrongly.',
    belief: 'This looks like a slip, not a wrong rule.',
  },
  'dropped-term': {
    id: 'dropped-term',
    name: 'A term disappeared',
    family: 'Slips',
    principle: 'Every term must be carried to the next line or removed by doing the same thing to both sides.',
    belief: 'A term can be left behind when the line is rewritten.',
  },
  unknown: {
    id: 'unknown',
    name: 'Unrecognised step',
    family: 'Slips',
    principle: 'Each line must be true for exactly the same values as the line above it.',
    belief: 'This step does not match a known pattern.',
  },
}

export const FAMILIES: Misconception['family'][] = ['Brackets', 'Powers', 'Terms and fractions', 'Balancing equations', 'Solution sets', 'Slips']

/**
 * Built-in explanation of a diagnosis. Maths is wrapped in $...$ for the renderer.
 * This is what a student sees when no language model is available, and it is also
 * the verified ground truth handed to the model when one is.
 */
export function explain(d: Diagnosis, reveal = true): string {
  const from = d.from ? `$${d.from}$` : 'the line above'
  const wrong = d.wrong ? `$${d.wrong}$` : 'your line'
  const right = d.right && reveal ? `$${d.right}$` : null
  switch (d.id) {
    case 'distribute-partial':
      return `You turned ${from} into ${wrong}. The multiplier reached one term in the bracket and skipped the rest.${right ? ` Multiplying every term gives ${right}.` : ''}`
    case 'negative-distribution':
      return `You turned ${from} into ${wrong}. The minus sign was applied to the first term in the bracket but not the others.${right ? ` Flipping every sign gives ${right}.` : ''}`
    case 'power-over-sum':
      return `You turned ${from} into ${wrong}, giving the power to each term on its own.${right ? ` Multiplying the bracket by itself gives ${right}.` : ''}`
    case 'exponent-rules':
      return `You turned ${from} into ${wrong}.${right ? ` The exponent rule gives ${right}.` : ''}`
    case 'unlike-terms':
      return `You combined terms in ${from} to get ${wrong}, but those terms have different variable parts, so they cannot be merged into one.`
    case 'fraction-add':
      return `You added ${from} top with top and bottom with bottom to get ${wrong}.${right ? ` With a common denominator it is ${right}.` : ''}`
    case 'cancel-across-sum':
      return `You turned ${from} into ${wrong}, cancelling against one term on top only.${right ? ` Dividing every term gives ${right}.` : ''}`
    case 'move-sign':
      return `From ${from} you wrote something equal to ${wrong}. A term crossed the equals sign and kept its sign.${right ? ` It should be ${right}.` : ''}`
    case 'divide-every-term':
      return `From ${from} you wrote something equal to ${wrong}. The division missed a term.${right ? ` Dividing every term gives ${right}.` : ''}`
    case 'multiply-every-term':
      return `From ${from} you wrote something equal to ${wrong}. The multiplication missed a term.${right ? ` Multiplying every term gives ${right}.` : ''}`
    case 'inverse-operation':
      return `From ${from} you wrote something equal to ${wrong}. The number was removed with the wrong operation.${right ? ` The inverse operation gives ${right}.` : ''}`
    case 'zero-product':
      return `From ${from} you wrote ${wrong}. Setting each factor equal to the right-hand side only works when that side is zero.${right ? ` First rearrange to ${right}.` : ''}`
    case 'forgot-plus-minus':
      return `Your line ${wrong} keeps only one of the two square roots. The negative root also solves the line above.`
    case 'root-sign':
      return `From ${from} you wrote ${wrong}. Each root has the opposite sign to the number in its bracket.`
    case 'lost-solution':
      return `Your line ${wrong} has fewer solutions than ${from}. A solution was lost, usually by dividing both sides by something that can be zero.`
    case 'extraneous-solution':
      return `Your line ${wrong} has a solution that ${from} does not have.`
    case 'sign-slip':
      return `One sign is off. Where you wrote ${wrong}${right ? `, it should be ${right}` : ''}.`
    case 'arithmetic-slip':
      return `The method is fine, but one number is off. Where you wrote ${wrong}${right ? `, it should be ${right}` : ''}.`
    case 'dropped-term':
      return `${from} became ${wrong}. A term went missing between the two lines.`
    case 'unknown':
      return 'This line is not equivalent to the one above it, and the change does not match a mistake pattern in the library.'
  }
}
