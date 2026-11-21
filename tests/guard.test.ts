import { describe, expect, it } from 'vitest'
import { analyze } from '../src/engine/analyze'
import { guardContext, inspectReply, isHard, mathRuns } from '../src/guard'

const ctxOf = (...lines: string[]) => guardContext(analyze(lines))!
// The equation checks and the number check are tested separately, so each test reads cleanly.
const kinds = (text: string, ...lines: string[]) =>
  inspectReply(text, ctxOf(...lines))
    .flags.map((f) => f.kind)
    .filter((k) => k !== 'foreign-number')
const strangeNumbers = (text: string, ...lines: string[]) =>
  inspectReply(text, ctxOf(...lines))
    .flags.filter((f) => f.kind === 'foreign-number')
    .map((f) => f.quote)

const BRACKETS = ['3(x - 2) + 4 = 19', '3x - 2 + 4 = 19', '3x + 2 = 19', '3x = 17', 'x = 17/3']

describe('reading maths out of prose', () => {
  it('separates maths from words', () => {
    const runs = mathRuns('You turned 3(x - 2) into 3x - 2, so a bracket was lost. Is 3 * 2 = 6?', new Set(['x']))
    expect(runs).toEqual(['3(x - 2)', '3x - 2', '3 * 2 = 6'])
  })
  it('drops brackets and full stops that belong to the sentence', () => {
    expect(mathRuns('(for example 2x + 3 = 11).', new Set(['x']))).toEqual(['2x + 3 = 11'])
    expect(mathRuns('That gives x = 4.', new Set(['x']))).toEqual(['x = 4'])
  })
  it('stops at the end of a sentence but keeps decimal points', () => {
    expect(mathRuns('Consider x = 2. (x + 5)^2 equals 49 there, and 0.5 + 0.5 = 1.', new Set(['x']))).toEqual(['x = 2', '(x + 5)^2', '49', '0.5 + 0.5 = 1'])
  })
  it('does not treat ordinary words as variables', () => {
    expect(mathRuns('a bracket is a group, and I think so too', new Set(['x']))).toEqual([])
  })
})

describe('tutor guard', () => {
  it('passes a reply that only uses the facts', () => {
    const reply =
      'You turned 3(x - 2) into 3x - 2, so the 3 only reached the x. It is tempting because the 3 sits right next to the x. You then wrote 3x + 2 = 19. What should happen to the 2?'
    const found = inspectReply(reply, ctxOf(...BRACKETS))
    expect(found.flags).toEqual([])
    expect(found.checked).toBe(1)
  })

  it('catches the answer being given away as an equation', () => {
    expect(kinds('Multiply everything by 3 and you will find x = 7 in the end.', ...BRACKETS)).toEqual(['answer-leak'])
  })

  it('catches the answer being given away in words', () => {
    expect(kinds('If you fix that line the answer is 7.', ...BRACKETS)).toEqual(['answer-leak'])
    expect(kinds('Then x is 7, not what you wrote.', ...BRACKETS)).toEqual(['answer-leak'])
  })

  it('lets the tutor repeat values the student wrote or the number check shows', () => {
    expect(kinds('You ended with x = 17/3. Try putting x = 17/3 into the first line.', ...BRACKETS)).toEqual([])
    expect(kinds('You wrote x = 7, but a square has two roots.', 'x^2 = 49', 'x = 7')).toEqual([])
    // The number check for a lost root has to show the root, so repeating it is not a new leak.
    expect(kinds('Check x = -7 as well.', 'x^2 = 49', 'x = 7')).toEqual([])
  })

  it('catches false arithmetic', () => {
    expect(kinds('Remember that 3 * 2 = 5, so the bracket becomes 3x - 5.', ...BRACKETS)).toEqual(['false-arithmetic'])
    expect(kinds('3 times 2 is 6, and 6 ≠ 6.', ...BRACKETS)).toEqual(['false-arithmetic'])
  })

  it('allows the failed number check to be quoted', () => {
    expect(kinds('With x = 17/3 the first line says 15 = 19, which cannot be true.', ...BRACKETS)).toEqual([])
  })

  it('accepts true identities, lines of the working and quoted steps', () => {
    expect(kinds('In general a(b + c) = ab + ac, and here 3(x - 2) = 3x - 6.', ...BRACKETS)).toEqual([])
    expect(kinds('You wrote 3x + 2 = 19.', ...BRACKETS)).toEqual([])
    expect(kinds('You wrote 3(x - 2) = 3x - 2, which skips the 2.', ...BRACKETS)).toEqual([])
    expect(kinds('The correct line is 3x - 6 + 4 = 19.', ...BRACKETS)).toEqual([])
  })

  it('reports an equation it cannot stand behind, without treating it as fatal', () => {
    const flags = inspectReply('So you should get 3x + 4 = 17 next.', ctxOf(...BRACKETS)).flags
    expect(flags.map((f) => f.kind)).toEqual(['unverified-equation'])
    expect(flags.some(isHard)).toBe(false)
  })

  it('catches a number the model brought in from nowhere', () => {
    expect(strangeNumbers('You took 9 away from 72 to get 63.', '9x = 72', 'x = 63')).toEqual([])
    expect(strangeNumbers('You wrote 63 instead of 7.', '9x = 72', 'x = 63')).toEqual(['7'])
    expect(strangeNumbers('If a product equals 6, each factor can equal 6.', '(x - 2)(x - 8) = 7', 'x - 2 = 7 or x - 8 = 7')).toEqual(['6'])
    // The corrected expansion is arithmetic the tutor is not allowed to do: the engine shows it on request instead.
    expect(strangeNumbers('Here 3(x - 2) = 3x - 6.', ...BRACKETS)).toEqual(['6'])
  })

  it('does not mistake line numbers, ordinals or squares for arithmetic', () => {
    expect(strangeNumbers('Look at line 5 again, the 5th step, and remember (a + b)² has a middle term.', '2(x + 3) = 14', '2x + 3 = 14')).toEqual([])
    expect(strangeNumbers('Put x = 17/3 into line 1 and you get 15, not 19.', ...BRACKETS)).toEqual([])
    expect(strangeNumbers('With x = 20/3 the line above gives 40.333, not 32.333.', '5(x + 2) - 3 = 2x + 19', '5x + 2 - 3 = 2x + 19')).toEqual([])
  })

  it('catches the finished answer of a simplify problem', () => {
    const lines = ['(x + 5)^2 - x^2', 'x^2 + 25 - x^2', '25']
    expect(kinds('Expanding properly gives 10x + 25.', ...lines)).toEqual(['answer-leak'])
    expect(kinds('Remember that (x + 5)^2 = x^2 + 10x + 25.', ...lines)).toEqual([])
    expect(kinds('You wrote x^2 + 25 - x^2 and then 25.', ...lines)).toEqual([])
  })

  it('catches the value of a numeric problem', () => {
    expect(kinds('With a common denominator you get 5/6.', '1/2 + 1/3', '2/5')).toEqual(['answer-leak'])
    expect(kinds('You wrote 1/2 + 1/3 = 2/5, adding tops and bottoms.', '1/2 + 1/3', '2/5')).toEqual([])
  })
})
