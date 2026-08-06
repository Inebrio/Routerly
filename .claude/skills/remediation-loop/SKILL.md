---
name: remediation-loop
description: Drive a story from BLOCKED back to PASS after validation, with a hard iteration cap. Use when a validation report lists blocking findings.
---

# Remediation loop

Triggered by blocking findings, and by nothing else. Non-blocking findings
are recorded in the story record and never restart this loop.

## One iteration

1. **Assign.** Give each blocking finding to whoever owns that surface. One
   engineer per finding where the findings are independent; one engineer for
   all of them where they share a file.
2. **Fix, narrowly.** The engineer fixes the listed findings and nothing
   else. No refactor, no cleanup, no improvement noticed in passing: an
   unrelated change in a remediation diff is how a second bug arrives
   disguised as a fix.
3. **Re-validate in full.** The validator re-runs the whole protocol, not
   only the failed criteria. A fix that breaks a criterion that passed
   before is the most common outcome, and a delta check never sees it.
4. **Read the verdict.** PASS ends the loop. BLOCKED starts the next
   iteration.

## Cap: three iterations

After the third BLOCKED, stop. Do not start a fourth.

Escalate to the human with: the findings that survived, what was tried in
each iteration and why it did not work, whether the blocker is in the code
or in the story, and the options with their costs.

## Rules

- **A finding fixed by weakening its check is not fixed.** Deleting the
  test, loosening the assertion, or removing the criterion returns the story
  to the validator as still blocked.
- **The engineer does not close a finding.** Only the validator's next
  report closes it.
- **A new blocking finding introduced by a fix counts against the same
  cap.** It does not reset the counter: introducing blockers while removing
  them is exactly the signal the cap exists to catch.
- **The same finding surviving two iterations means the diagnosis is
  wrong.** Stop patching the symptom, re-read the code around it, and say
  what you now think is happening before the third attempt.
- **A finding that contradicts the story is not a fix.** It goes back up as
  a story problem, and the loop pauses until that is answered.

## Record

Append to the story's validation file, one block per iteration: the
findings, who took them, what changed, and the resulting verdict. The
history is what makes the third failure legible to the human who has to
decide.
