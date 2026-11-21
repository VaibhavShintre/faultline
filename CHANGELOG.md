# Changelog

## Global AI Builder's Challenge (work done from 21 November 2026, 00:00 PST)

Faultline existed before this event opened. The state it was in at that moment is the git tag
[`pre-gaibc`](https://github.com/VaibhavShintre/faultline/tree/pre-gaibc) (last commit 20 November 2026, 22:55 PST).
Everything below was added after the event opened. The full diff is
[`pre-gaibc...main`](https://github.com/VaibhavShintre/faultline/compare/pre-gaibc...main).

### What existed at the start

- The symbolic engine: parser, exact fractions, polynomials, rational functions, equivalence of lines, numeric root finder.
- Diagnosis of the first wrong line against a library of documented wrong rules.
- The fault card, the number check, the on-device tutor (Gemini Nano through Chrome's Prompt API), targeted practice and the misconception map.
- 53 tests.
- Lines after the fault line were not marked at all. The tutor's replies were shown as the model wrote them.
- The number check used a solution of the correct line as its test value, which quietly gave the answer away.

### Added during the event

1. **Marking after the fault line.** Every later line is now classified: it *carries the mistake forward* (the step is sound, its input was wrong),
   it is a *second, separate mistake* with its own diagnosis, number check and practice link, or it puts the working *back on track*.
   Each separate mistake is counted against its own misconception in the map.
   (`src/engine/analyze.ts`, `src/components/FaultCard.tsx`, `src/components/StepEditor.tsx`, `tests/after-fault.test.ts`)
2. **The engine now checks the tutor.** Every equation in a tutor reply is read out of the prose and checked symbolically. A draft that gives
   away the answer or states false arithmetic is stopped while it is still streaming and written again once; if the second draft fails too,
   nothing is shown. An equation the engine cannot confirm is shown with a warning. Replies that pass say how many equations were checked.
   (`src/guard.ts`, `guardedSay` in `src/ai.ts`, `tests/guard.test.ts`)
3. **A number check that does not give the answer away.** The check now prefers a value that makes the student's own line true and the line above
   false. It falls back to a true solution only when a lost solution is the whole point of the mistake.
   (`counterexample` in `src/engine/line.ts`)
4. **An AI check anyone can rerun.** A new Lab page runs two fixed test sets on the on-device model: whether the model can find the wrong line by
   itself (the design Faultline rejected), and how often the tutor breaks a rule and what the guard does about it. The recorded results ship with
   the app and are written up in [`docs/evaluation.md`](docs/evaluation.md).
   (`src/lab/`, `src/components/Lab.tsx`, `tests/lab.test.ts`)
5. **A "Two mistakes" example** on the Check page, and 25 more tests (78 in total).
