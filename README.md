# Faultline

**Find the line where it broke, and why.**

Faultline is a maths tutor that reads a student's working line by line, finds the exact line where the reasoning went wrong, and names the misconception behind it. Then it helps the student repair that one idea and tracks whether it is really gone.

**Live demo:** https://vaibhavshintre.github.io/faultline/

**Demo video (3 min):** https://youtu.be/wyc7cWXW9ps

![Faultline finding the fault line and marking the lines after it](docs/shot-fault.jpg)

| A second, separate mistake | How the on-device model was checked |
|---|---|
| ![A second mistake diagnosed against the line above it](docs/shot-second.jpg) | ![Engine 24 of 24, model alone 12 of 24](docs/shot-lab.jpg) |

## The problem

A red cross next to a final answer tells a student nothing. Research on error analysis in mathematics education is consistent on this point: most wrong answers in algebra come from a small set of stable, predictable wrong rules ("mal-rules"), not from random carelessness. A student who believes that `2(x + 3)` is `2x + 3` will keep losing marks until someone points at that belief.

Teachers can do this for one student at a time. Answer-checking apps cannot do it at all, and general chatbots do it unreliably because they re-derive the maths themselves and sometimes get it wrong.

## What Faultline does

1. **Exact checking.** Every line is compared with the line above it using exact symbolic arithmetic. Two equations are equivalent when they have the same solution set, and two expressions are equivalent when they are equal as rational functions. The first line that changes the meaning is the fault line. A correct line is never marked wrong.
2. **Diagnosis by model tracing.** A library of documented wrong rules is replayed on the student's previous line. If a wrong rule reproduces what the student wrote, that rule is the diagnosis. Comparison is by mathematical equivalence, not spelling, so the student can have tidied up in the same line and still be matched.
3. **A number check the student can do by hand.** Faultline finds a concrete value where the two lines disagree ("put x = 17/3 into both lines: the line above is false, 15 ≠ 19, but your line is true, 19 = 19"). It picks a value that does not give the answer away.
4. **The lines after the fault line.** Each later line is marked as carrying the mistake forward (the step is sound, its input was wrong), as a second, separate mistake with its own diagnosis, or as back on track.
5. **An on-device tutor that is itself checked.** A language model running inside the browser says why the wrong idea is tempting and asks a question back. It is given only facts the engine has already verified. Every equation and number in its reply is then checked by the engine: a draft that gives away the answer or does arithmetic of its own is stopped mid-stream and rewritten, and withheld if it fails twice.
6. **Targeted practice.** One click generates a fresh problem built to tempt that exact mistake. Each generator is self-tested: the engine confirms that the tempting wrong step really is diagnosed as that misconception before the problem is shown.
7. **A misconception map.** Bayesian Knowledge Tracing estimates, for each misconception, the probability that it is gone. Students can copy a plain-text report for their teacher.

## Where the AI is

| Technique | Role |
|---|---|
| Model tracing with mal-rules (the method behind cognitive tutors) | Decides *which* misconception explains a wrong step |
| Symbolic algebra over exact rationals, with numeric root finding | Decides *whether* a step is valid, with no false alarms |
| Bayesian Knowledge Tracing (a hidden-Markov learner model) | Estimates mastery of each misconception over time |
| Gemini Nano through Chrome's built-in Prompt API | Says why the wrong idea is tempting, asks a question back, answers follow-up questions |
| The same symbolic engine, pointed at the model's output | Checks every equation and number the tutor writes before the student relies on it |

The division of labour is deliberate. The language model never marks anything. It receives a list of verified facts, and its own reply is checked against them.

## How the AI was checked

Three fixed checks run on the on-device model from the app's Lab page ("See how the model is checked"). Full method, results and limits: [docs/evaluation.md](docs/evaluation.md).

| Check | Result (Chrome 156, 21 November 2026) |
|---|---|
| Find the first wrong line in 24 workings with hand-set answers | Symbolic engine 24 / 24. The model on its own: 12 / 24 and 14 / 24 in two runs. |
| Explain 37 mistakes from verified facts | Shipped version: 0 drafts gave the answer away. Reading all 37 replies, 5 still had a muddled or wrong sentence in words. |
| The student asks "just tell me the final answer" (13 cases) | 13 / 13 kept it back. In an earlier round one draft gave it away and the guard stopped it mid-sentence. |

The tutor's job was narrowed three times because of these results. It began as a free explanation and is now two sentences: why the idea is tempting, and one question. The exact explanation always comes from the engine.

Because the model runs on the device, there is no API key, no server and no cost per student, and the student's work never leaves the browser. In a browser without a built-in model, Faultline still works fully: the diagnosis, the number check, the rule and the practice loop all come from the engine.

## Misconceptions it recognises

Brackets: partial distribution, lost negative. Powers: power over a sum, exponent rule mix-ups. Terms and fractions: combining unlike terms, adding fractions straight across, cancelling inside a sum. Balancing equations: moving a term without changing its sign, dividing or multiplying only part of an equation, using the wrong inverse operation. Solution sets: zero-product rule without a zero, forgetting the ± root, reading roots with the wrong sign, losing a solution, picking up an extra one. Slips: sign slips, arithmetic slips and dropped terms, each pinpointed to the exact number or term.

## Try it

Open the live demo and click one of the "real student working" chips, or type your own working, one step per line:

```
3(x - 2) + 4 = 19
3x - 2 + 4 = 19
3x + 2 = 19
3x = 17
x = 17/3
```

For the conversational tutor, use desktop Chrome 138 or later. The first use may download the on-device model.

## Run it locally

```bash
npm install
npm run dev      # start the app
npm test         # run the engine tests
npm run build    # production build in dist/
```

## How the code is organised

```
src/engine/rational.ts   exact fractions on BigInt
src/engine/ast.ts        expression parser, printers (text and TeX), tree rewriting
src/engine/poly.ts       multivariate polynomials, rational functions, exact surds
src/engine/line.ts       lines of working, equivalence, root finding, number checks
src/engine/malrules.ts   the mal-rule library and the diagnosis procedure
src/engine/analyze.ts    walks a whole piece of working: the fault line, and every line after it
src/engine/catalog.ts    names, principles and built-in explanations
src/engine/bkt.ts        Bayesian Knowledge Tracing
src/engine/practice.ts   self-verifying practice generators
src/ai.ts                on-device tutor (Chrome Prompt API) and the guarded call
src/guard.ts             reads the maths out of a tutor reply and checks it
src/lab/                 the fixed AI checks and their recorded results
src/App.tsx, src/components/   the interface (React)
tests/                   81 tests: engine, lines after the fault, guard, AI check cases
docs/evaluation.md       how the AI was checked, with results and limits
CHANGELOG.md             what was added when
```

The engine has no dependencies and no network access. The interface uses React and KaTeX.

## Limits

- The checker covers school algebra: polynomial and rational expressions, linear and polynomial equations in one variable, and square roots of constants. Trigonometry, logarithms, inequalities and systems of equations are not supported yet.
- A wrong step that combines two different mistakes in one line is reported as unrecognised, with the number check still shown.
- The tutor's wording comes from a small on-device model. Its equations and numbers are checked, but a muddled sentence in words is not something the engine can catch; about one reply in seven had one in the last check.
- Two workings that both have no solution count as equivalent, so a wrong step between them is not flagged.
- The conversational tutor needs a browser with a built-in model. Everything else works anywhere.

## Built with

TypeScript, React, Vite, KaTeX, Vitest, and Chrome's built-in Prompt API.

The first version was built on 20 and 21 November 2026. The marking of lines after the fault, the guard on the tutor, the non-revealing number check and the AI checks were added from 21 November during Global AI Builder's Challenge; see [CHANGELOG.md](CHANGELOG.md). An AI coding agent (Claude Code) did most of the implementation.

## Licence

MIT
