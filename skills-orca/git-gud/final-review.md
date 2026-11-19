# git-gud: Bounded Final Review

Read before requesting the final review and when routing its verdict.

## 4. Bounded Final Review

**Total budget: one plan review, one final review, at most one final re-review.** No stronger-model gate or additional deep pass. Reuse/replacement never resets this budget.

Use one suitable independent Pi reviewer from the final-review routing row (`routing.md`), preferably the plan reviewer; create only if none qualifies. Supply the spec/plan paths, diff/base reference and test evidence. Review the whole implementation against the spec for correctness, code quality, regressions/tests and security/edge cases in one verdict. Freeze reviewed files until it returns. Record scope, reviewer, revision, verdict and rounds used.

Final review and optional re-review name their scope and return:

```
VERDICT: PASS | FAIL
FINDINGS:
- [Critical|Important|Minor] <file:line> — <what is wrong, evidence>
(or: - none)
```

Critical or Important findings force FAIL; Minor findings do not block. A missing or inconsistent verdict is a blocker: report and stop for the user's decision. Do not automatically request clarification, replace the reviewer, add rounds or silently assume PASS.

Route valid results mechanically:

- **Initial Critical/Important findings:** create fix beads, link coupled dependencies, and dispatch to original owners with green tests and task commits. Send the **same reviewer one follow-up** with `send --to dispatch:<last review dispatch>` (it reopens the reviewer's session), carrying finding/fix deltas and affected invariants; broaden scope for cross-cutting changes.
- **Remaining or new Critical/Important findings after that re-review:** report unresolved blockers and stop for the user. No further autonomous fix/review cycle; integration is not ready.
- **Minor findings:** these fixes land after the last review, so they are capped. Fix at most **3** Minor findings, each **≤20 changed lines** and **≤60 lines in total** (insertions + deletions from `git diff --numstat`). Each fix gets its own commit with the full suite passing. List them in the summary under **Unreviewed changes** (finding → commit, “not independently reviewed”). Every other Minor finding becomes a report note. No splitting a fix to fit the cap, and no additional review round for nits. Critical/Important findings never go here.
- **Clean pass:** proceed to Finish, without another gate.
