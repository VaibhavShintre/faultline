## Overview

Faultline is a maths tutor that reads your working line by line, finds the exact line where it went wrong, and names the misconception behind it. Then it helps you repair that one idea and tracks whether it is really gone.

It runs entirely in the browser. The tutor's language model runs on your device, so there is no API key, no server, and your work is never uploaded.

**Try it:** https://vaibhavshintre.github.io/faultline/ (click one of the "real student working" examples)

## The problem

A red cross next to a final answer tells a student nothing. Decades of research on error analysis show that most wrong answers in algebra come from a small set of stable wrong rules, not from random carelessness. A student who believes that 2(x + 3) is 2x + 3 will keep losing marks until someone points at that belief.

A good teacher does this for one student at a time. Answer-checking apps cannot do it, because they only look at the last line. General chatbots do it unreliably, because they redo the maths themselves and sometimes mark correct work wrong.

Faultline is for school and first-year university students doing algebra homework, and for the teachers and tutors who want to know which idea to reteach.

## The solution

You type your working, one step per line, exactly as you wrote it on paper.

1. **It finds the fault line.** Every line is compared with the one above it using exact symbolic arithmetic. The first line that changes the meaning is marked. A correct line is never marked wrong.
2. **It names the misconception.** For example "Partial distribution: only the first term in the bracket gets multiplied".
3. **It gives a number check you can do by hand.** "Put x = 7 into both lines: 19 = 19, but 23 ≠ 19."
4. **A tutor talks it through.** It uses your own numbers, explains why the wrong idea is tempting, asks you a question back, and answers follow-up questions. It never gives away the final answer.
5. **You practise that exact mistake.** One click generates a new problem built to tempt it.
6. **Your misconception map updates.** Each misconception has a mastery estimate that falls when you slip and rises when you solve cleanly. You can copy a report for your teacher.

## AI implementation

Faultline combines four techniques, each used for what it is good at.

**Model tracing with mal-rules.** This is the method behind cognitive tutors, going back to Brown and Burton's BUGGY (1978) and Sleeman's algebra mal-rules (1984). Faultline holds a library of documented wrong rules. It replays each one on the student's previous line, and if the result is mathematically identical to what the student wrote, that rule is the diagnosis. Because the comparison is by equivalence and not by spelling, the student can have tidied up in the same line and still be matched. When no forward rule fits, it works backwards from the student's line to find a single flipped sign or a single wrong number.

**Symbolic algebra.** Faultline has its own small computer algebra engine, written in TypeScript for this project: a parser, exact fractions on BigInt, multivariate polynomials, rational functions, exact square roots of constants and a numeric root finder. Two equations are equivalent when they have the same solution set. Two expressions are equivalent when they are equal as rational functions. This is what makes the marking trustworthy.

**Bayesian Knowledge Tracing.** A hidden-Markov learner model (Corbett and Anderson, 1995) estimates, for each misconception, the probability that it is gone.

**An on-device language model.** The tutor uses Gemini Nano through Chrome's built-in Prompt API. The model never marks anything. It receives a list of facts the engine has already verified (the last correct line, the wrong line, the diagnosed misconception, the number check) and turns them into a short explanation in the student's own numbers. Follow-up questions go to the same session, with the same facts and the same instruction not to reveal the answer. One warmed-up session is cloned for each conversation so the first reply is fast.

This division of labour is the main design decision. Language models are good at wording and bad at arithmetic, so the arithmetic is done by code that cannot be wrong, and the model is given only the job it is good at.

## How it was built

TypeScript, React and Vite, with KaTeX for rendering maths and Vitest for tests. The engine has no dependencies and no network access. The site is static and deployed to GitHub Pages by a GitHub Actions workflow that runs the tests first.

There are 53 engine tests. The practice generators test themselves: before a practice problem is shown, the engine confirms that the tempting wrong step for that problem really is diagnosed as the misconception being practised.

The project was built with an AI coding agent (Claude Code), which did most of the implementation.

## Challenges

- **Deciding what "equivalent" means.** x² = 9 and x = 3 are both true for x = 3, but the second has lost a solution. Comparing solution sets, not just testing values, lets Faultline say "you forgot the ± root" and not just "wrong".
- **Coincidences.** With unlucky numbers, a distribution mistake can look exactly like a sign mistake. The practice generators now reject any problem where the engine's own diagnosis is ambiguous.
- **Keeping the model honest.** A small on-device model should not be trusted to redo the maths. The prompt gives it verified facts only, tells it those facts are final, and forbids it from giving the final answer.

## What I learned from it

How intelligent tutoring systems actually work, and that a small, exact engine paired with a small on-device model is a good fit for a narrow task where trust, cost and privacy matter.

## Testing and iteration

- **Automated tests.** 53 tests cover the parser, the equivalence checker, each kind of diagnosis, the practice generators and the mastery model. They run on every push before the site is deployed.
- **Generators that test themselves.** The first version of the practice generators failed its own test: with some random numbers the tempting wrong step was accidentally correct, or looked like a different mistake. Each generator now redraws until the engine confirms the trap.
- **Testing in the browser.** Running the full flow in Chrome turned up two interface bugs that unit tests could not: focus did not move to the new line after pressing Enter, and a line that could not be read was reported as "correct so far". Both are fixed.
- **Tuning the tutor.** The on-device model answered slowly the first time, so one session is now loaded when the page opens and cloned for each conversation. Its replies sometimes contained Markdown symbols, which are now stripped without touching multiplication signs.

## Credits

Solo entry, built with an AI coding agent (Claude Code), which did most of the implementation and produced the demo video. Libraries: React, Vite, KaTeX and Vitest. Fonts: Instrument Serif, Inter and JetBrains Mono. Language model: Gemini Nano, through Chrome's built-in Prompt API. The demo video is narrated by a text-to-speech voice. No code is reused from earlier projects. Faultline was built on 21 November 2026 and is entered in several student hackathons running at that time, as their rules allow.

## What's next

- Marking the lines after the fault as "consistent with your mistake" or not, so one early slip does not hide a second one
- Reading a photo of handwritten working with the on-device model's image input
- Inequalities, systems of equations, logarithms and trigonometry
- A class view for teachers that shows the most common misconception across a whole group

## Access instructions

Open https://vaibhavshintre.github.io/faultline/ in any modern browser. No account is needed. The diagnosis, number check, practice and map work everywhere. The conversational tutor appears in desktop Chrome 138 or later, which may download the on-device model the first time.

Source code: https://github.com/VaibhavShintre/faultline
