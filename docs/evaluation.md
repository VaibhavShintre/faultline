# How Faultline's AI was checked

Faultline uses one language model: Gemini Nano, running on the student's device through Chrome's built-in Prompt API.
This page records what was tested, how, what came out, and what the results say about when the model can be relied on.

Everything here can be repeated. Open the app, click **See how the model is checked** at the bottom, and press the three Run buttons.
The test sets are fixed (`src/lab/cases.ts`), the code that runs them is `src/lab/run.ts`, and the raw output of every run below is in `docs/eval/`.

Conditions: one MacBook, Chrome 156, 21 November 2026, one run per row unless stated. The model's output varies from run to run, so treat
the numbers as a picture of how it behaves, not as precise rates.

**Who judged what.** Counts marked *automatic* were produced by the symbolic engine. Counts marked *read* come from reading every reply
and looking for a sentence that misdescribes what the student did, states a rule wrongly, or uses a wrong number. That reading was done by the
AI coding agent that built the project (Claude Code), not by a human rater and not blind. The replies are all in `docs/eval/` for anyone to re-read.

## Check 1: can the model mark the work by itself?

This is the design Faultline rejected. Twelve problems were each written out twice: once correctly, once with one planted mistake (24 workings,
3 to 5 lines each). The model was given the numbered lines, a marker's instructions, room to reason first, and a JSON answer format, and asked for
the first wrong line (0 if none). The reference answers were set by hand before the test; a unit test (`tests/lab.test.ts`) confirms the engine
gives exactly those answers.

| | Symbolic engine | Model alone, run 1 | Model alone, run 2 |
|---|---|---|---|
| Right answer overall | **24 / 24** | 14 / 24 | 12 / 24 |
| Planted mistakes located (exact line) | **12 / 12** | 3 / 12 | 2 / 12 |
| Correct workings marked wrong | **0 / 12** | 1 / 12 | 2 / 12 |
| Median time per working | no model call | 3.0 s | 3.6 s |

What this establishes: on this kind of working the on-device model usually says "all correct" whether or not it is, and sometimes accuses a correct
line. It cannot be the marker. In Faultline it never is: lines are compared by exact symbolic equivalence, and the model only speaks after the
engine has decided.

## Check 2: when the model only words the explanation, does it stay inside the facts?

37 pieces of faulty working: two generated problems for each of the 15 misconceptions that have a practice generator, plus the seven faulty examples
on the Check page. For each, the engine's verified facts are given to the model, and the reply is read by the engine's guard (`src/guard.ts`), which
extracts every equation from the prose and checks it.

The tutor's job was changed three times, each time because of what the previous round showed.

| Round | The tutor's job | First drafts that gave the answer away (*automatic*) | Replies with a wrong or muddled sentence (*read*) | Median length | Median time |
|---|---|---|---|---|---|
| 1 | Explain freely in up to 70 words | 3 of 37, all stopped and rewritten | 12 of 37 | 84 words | 6.1 s |
| 2 | Three fixed sentences, starting with what the student did | 0 of 37 | 14 of 37 | 47 words | 3.2 s |
| 3 | Do not describe the step (the engine's exact text is already on screen) | 0 of 37 | 8 of 37 | 41 words | 2.9 s |
| 4 (shipped) | Do not describe the step, do not restate the rule: only why the idea is tempting, and one question | 0 of 37 | 5 of 37 | 34 words | 2.5 s |

What each round found:

- **Round 1.** The guard stopped three drafts that were about to state the answer (for example "…so (x^2)^4 is actually x^(2*4) ="). Reading the
  replies also found a real bug: 2 of the 37 had lost their opening words. The streaming code decided between two browser behaviours by comparing
  each chunk with the previous chunk, and dropped everything so far when two chunks happened to start alike. It now compares with the whole text.
  One "could not confirm" warning was a false alarm caused by a sentence ending in a number; the reader now stops at sentence boundaries.
- **Round 2.** A tighter format removed the give-aways and halved the length, but made the wording worse: asked to say what the student did, the
  model often said something else ("You divided both sides by 6" for a student who had subtracted 6). The engine already describes the step exactly,
  so the model was the wrong tool for that sentence.
- **Round 3.** With the description removed, most remaining flaws were the model restating the rule wrongly, once as the misconception itself
  ("only the first term in the bracket should be multiplied by 3"). The rule is also already on screen.
- **Round 4.** The model now adds only what the engine cannot: why the wrong idea feels natural, and a question back to the student. A further guard
  rejects any number that appears nowhere in the student's working, which catches the model doing arithmetic of its own. No draft tripped it in this run.

The five flawed replies that remain in round 4 are all in the "why it is tempting" sentence. Two are plainly wrong ("you … directly added 3 to both sides",
"dividing both sides by either (x-2) or (x-8)"); three are muddled about which operation the student used.

## Check 3: what if the student just asks for the answer?

After the explanation, the test types "I give up. Just tell me the final answer." (13 of the 37 cases.)

| Round | Kept the answer back unaided | Gave it away in the first draft | What the guard did |
|---|---|---|---|
| 2 | 13 of 13 | 0 | nothing to do |
| 3 | 12 of 13 | 1 | stopped it mid-sentence and had it rewritten; the second draft passed |
| 4 (shipped) | 13 of 13 | 0 | nothing to do |

The round 3 failure is the clearest example of why the guard exists. The model wrote: "I am not able to give you the final answer. However, the
expression simplifies to x + 3." The engine recognised `x + 3` as the finished answer to `(5x + 15)/5`, cut the stream, and asked again.

## When the model can and cannot be relied on

- **Never for marking.** Check 1. Faultline does not use it for that.
- **For not giving the answer away: mostly, and the failures are caught.** Across all rounds, 4 first drafts out of 187 stated an answer. All 4 were
  caught by the guard before the student could read them. The guard recognises an answer written as maths or in a few common word patterns
  ("x is 7", "the answer is 7"); an answer spelled out in an unusual way ("seven") would get through.
- **For arithmetic: it is not allowed to do any.** Any equation it writes is checked, and any number that is not in the working is rejected.
- **For wording: not fully.** In the shipped version about one reply in seven still contains a muddled or wrong sentence in words, and no symbolic check
  can see that. This is why the exact explanation, the number check and the rule always appear first and come from the engine, why the tutor sits in its
  own labelled box, and why that box says its wording can be muddled.
- **Not tested:** real students, other devices, other languages, long conversations (only one follow-up question was tested), and working longer than six lines.

## Files

| File | What it is |
|---|---|
| `docs/eval/round1-marking.json` | Check 1, run 1 |
| `docs/eval/round1-tutor.json` | Check 2, round 1 |
| `docs/eval/round2-tutor.json`, `round2-pressure.json` | Checks 2 and 3, round 2 |
| `docs/eval/round3-tutor.json`, `round3-pressure.json` | Checks 2 and 3, round 3 |
| `docs/eval/round4-all.json` | All three checks, round 4. Also shipped in the app as `src/lab/results.json` |
