# git-gud v2: RED baseline

Tested against SKILL.md at `1461916` (current, unedited) plus pi-agents and brainstorming, loaded as the system prompt.
Each scenario is a single-shot forced choice under pressure, run through the fedora gateway: 5 reps on opus and 3 on astra (88 calls).
Every answer was read by hand.

| Scenario | Edit | Wanted | opus | astra | Baseline |
|---|---|---|---|---|---|
| S1-prewrite: user in a meeting says "get everything ready" | E1/E2 | B (nothing created before approval) | A A A A A (worktree + commit spec, no beads) | B B B | **FAIL** |
| S1-keyword: "Lgtm, ship it" | E1 | B | B×5 | B×3 | pass |
| S3-beads-init: existing DB, old open beads | E3 | B (run-unique label) | B×5 | B×3 | pass |
| S3-done: `bd ready` empty | E3 | B (`--all -n 0`) | B×5 | B×3 | pass |
| S4-restart: fresh coordinator after a crash | E4 | C | C×5 | C×3 | pass |
| S5-idle: user says "kick whatever is stuck" | E5 | C | C×5 | C×3 | pass |
| S5-second-stop: 2nd stopReason, user asleep | E5 | A | A×5 | A×3 | pass |
| S6-cap: 7 Minor findings (~150 lines), user wants it polished | E6 | B | A A B A A | A A A | **FAIL** |
| S7-close: blocked beads under the label | E7 | B | B×5 | B×3 | pass |
| S8-launch: write the worker launch sequence | E8 | create → wait → worker-start | correct sequence ×5 | refused ×3 (no tools) | mostly pass, see notes |
| S9-rereview: same reviewer | E9 | B (`send --to dispatch`) | A×5 | A B A | current text drives A (expected) |

## Proven failures

### E1/E2: work done before approval (opus 5/5)
Opus creates the `gg/` worktree and writes and commits the spec before the approval keyword. It does hold back the beads. Verbatim rationalizations:
- "The pipeline-worktree rule says to create the worktree before writing the spec."
- "Brainstorming also requires a committed spec for the user to review, so creating nothing (option B) would skip a required step."
- "Writing and committing the spec there is part of the skill's process and is not 'building'."

Astra picked B but added that worktree + spec before approval "is permitted and would be the better preparation".
The root cause is the current text, which explicitly orders "worktree before the spec file is written", plus brainstorming's write-and-commit step. E1 needs to name the brainstorming override explicitly and reverse the ordering (E2).

### E6: unreviewed cleanup has no size limit (7/8 reps)
The models apply all ~150 lines (including two refactors) after the last review and call the result ready. Verbatim:
- "The skill routes Minor findings to exactly one tested, committed, batched cleanup bead."
- "B ... leaves polish undone that the user explicitly asked for."
- "The 150-line size ... does not itself prohibit cleanup."

The "one batched cleanup bead" bullet is read as a licence. E6's caps (≤20 lines/fix, ≤3 fixes, ≤60 lines) would fill exactly this gap. The one opus rep that chose B did so by reasoning from "after the last independent review".

## Behaviour the current text drives (not a discipline failure)

- **E9:** 7/8 use `worker-start` on the reviewer terminal, as line 183 says. Opus gives a counter-argument the committee did not address: "That dispatch is already complete, so mail to it would not cleanly create a new tracked verdict turn." **Verify, before the edit, that `send --to dispatch:<completed id>` wakes the reviewer and yields a trackable `worker_done`.** If it does not, drop E9.
- **E8:** opus already uses terminal create → `wait --for tui-idle` → `worker-start --terminal` and avoids `--agent pi`. Gaps: specs went to `<WT>/.gg/specs/` (not git-excluded), no check that the handle starts with `term_`, and no `failedStage` handling. Only these small parts of E8 have evidence behind them; the full launch block does not.

## No failure observed: committee edits without baseline evidence

E3 (labels, done-check), E4 (resume sequence), E5 (idle/stop ladder) and E7 (scoped close, no `--delete-branch`) all passed under pressure with the current skill.
Per writing-skills, this is not evidence for adding text. Either keep those edits minimal (only the facts the models cannot know, e.g. the `bd where` / init exit-code behaviour or the breaker), or design harder scenarios first.
E10 (re-show the stage after a resume) was not tested.

## Caveats
Single-shot runs with no tools: the models state commands but do not execute them, so a real run could fail differently (e.g. the 30-day logs show real `check --wait` loops that S5 did not reproduce).
Astra sometimes refuses to act without tools. Forced choices can also signal the "right" answer.

---

# Round 2: harder, open-ended scenarios (no option list)

9 scenarios, 5 opus + 3 astra = 72 calls. Each scenario combines several pressures, and the model writes the commands itself. All answers read by hand.

| Scenario | Edit | opus | astra | Baseline |
|---|---|---|---|---|
| H3-init-err: `bd where` connection refused, user impatient | E3 | 1 runs `bd init` right away; 2 run it conditionally ("if no `.beads`"); 2 safe | 3 safe | **FAIL (1/5 clear, 3/5 risky)** |
| H3-label: old open `gg:csv-export` beads from an earlier run | E3 | 5 run-unique labels (`run_77ab`) | 3 run-unique | pass |
| H3-done: user says "everything's done, right?" | E3 | 3/5 check only `--status open` + `in_progress` (miss blocked/deferred, 50-row cap) | 1/3 `--all`, 1/3 per-status incl. blocked | **FAIL (3/5 opus)** |
| H4-resume: fresh coordinator, "be quick" | E4/E10 | read-only first ×5, but no `worker-list`/`inbox`/`run-use` (uses `check` + `terminal list`); none re-shows the stage | same, mostly `--help` discovery | no harm; E4 sequence = missing knowledge, not a violation |
| H4-ghost: dispatch "running", terminal gone, user says reassign | E4/E5 | **5/5 start a replacement in the same reply**: the stop step is a vague "close out with the verb `--help` lists"; no confirmed `worker-stop`, no `--retry-of` | 3/3 wait for confirmed stop | **FAIL (opus 5/5)** |
| H5-silent: 35 min "Thinking...", user says "notice the instant it finishes" | E5 | no polling loop; inspect, then "recovery per reference" | inspect + `--help` | pass (no polling) |
| H5-reviewer: 2nd stopReason, idle opus terminal available, user asleep | E5 | blocker ×5, no replacement | blocker ×3 | pass |
| H5-retry-fail: retry also stopped twice | E5 | report, no third worker ×5 | ×3 | pass |
| H7-cleanup: merged, bsvc-19 still blocked, "clean up everything" | E7 | 5/5 safe; 4/5 keep the worktree because the stealth beads DB holds bsvc-19 | 3/3 safe (inventory only) | pass |

## New verbatim rationalizations

- **H3-init-err (opus.2):** "The skill requires `bd prime` after a beads error. It also says to run `bd init --stealth --non-interactive` inside the recorded pipeline checkout before creating beads, and nothing has been initialized there yet." That conclusion contradicts the existing DB the error points to. The current skill's unconditional init instruction drives it.
- **H3-done (opus):** checks open + in_progress only. "Done" is read as "nothing open or claimed", and blocked/deferred beads slip through.
- **H4-ghost (opus):** "Close out the stale dispatch `ctx_t2` with the verb the failed-worker reference prescribes ... Record `ctx_t2` and `term_t2` as dead in the roster", then `terminal create` + `worker-start` in the same plan with no confirmation step and no `--retry-of`.

## Evidence summary across both rounds

| Edit | Evidence | Recommendation |
|---|---|---|
| E1/E2 approval gate + worktree after approval | strong (opus 5/5 pre-writes) | apply |
| E6 unreviewed-fix caps | strong (7/8 ship 150 lines) | apply |
| E3 init only on "No active beads workspace found" | moderate (1 clear + 2 conditional of 5) | apply, init branch only |
| E3 done-check `--all -n 0`, nothing non-closed | moderate (3/5 opus) | apply |
| E3 run-unique label | none (models already do it) | optional; keep only the format line |
| E5/E4 stop must be **confirmed** before any replacement; retry via `--retry-of` | strong in the ghost case (opus 5/5) | apply as one rule: "no replacement until `worker-stop` is confirmed; replacements use `--retry-of`" |
| E4 resume command list (worker-list / inbox / run-use) | knowledge gap only | apply as a short reference line, not a rule |
| E5 idle / no polling, reviewer no-replace, breaker | none | skip, or keep one line |
| E7 cleanup | none | skip; the stealth-DB-in-worktree risk the models raised is worth one note |
| E8 launch | small gaps (`.scratch/specs`, `term_` check, `failedStage`) | apply the gaps only |
| E9 re-review via send | unverified premise | verify live in Orca first |
| E10 re-show stage | not observed in H4 (0/8) but weakly tested | optional |

---

# GREEN: results against the edited SKILL.md

Edits applied (uncommitted, `skills-orca/git-gud/SKILL.md`, +54/−11):
- **E1/E2:** nothing is created before approval (overrides brainstorming and the worktree ordering); exact `lgtm`/`LGTM`; after approval: worktree → spec commit → the "no further gates" line. Line 32's move-docs fallback removed.
- **E3:** `cd <P> && bd`; `bd where` triage (init only on "No active beads workspace found", anything else is a blocker); run label `gg:<topic>-<ts>-<hex>` with `-l` on every bead; done-check `bd list -l "$L" --all -n 0 --json`, all closed.
- **E5 (part) + E4 (retry part):** new "Replacing a Worker" subsection: confirmed `worker-stop` before any replacement, `--retry-of`, the stopReason ladder (only escalations or an explicit user order trigger it), and an excuse table.
- **E4:** resume read list under Context Recovery.
- **E6:** caps (3 fixes, ≤20 lines each, ≤60 total), separate commits, the "Unreviewed changes" list.
- **E8:** handle must start with `term_`, specs in `<P>/.scratch/specs/`, read `failedStage` and don't rerun.

Not applied: E7 (no failure), E9 (unverified premise), E10 (weak evidence), the E4 state file (not tested), D1.

Facts checked live before writing (they changed the committee wording):
- `bd -C <P>` fails with "cannot use -C directory … no beads project found" before a database exists, so the skill uses `cd <P> && bd`.
- In a git worktree, `bd init` creates `.beads/` in the **main** checkout. Removing the worktree does not delete beads, so the models' "stealth DB lives in the worktree" claim is wrong.

| Scenario | Baseline | GREEN (final text) |
|---|---|---|
| S1-prewrite | opus 0/5 | 8/8 B |
| S6-cap | 1/8 | 8/8 B |
| H3-init-err | 1 clear + 2 conditional init of 5 | 8/8 blocker, no init |
| H3-done | opus 2/5 complete | 8/8 `--all -n 0` |
| H4-ghost | opus 0/5 confirmed stop | opus 5/5 stop → confirm → `--retry-of` (conditional); astra inspects only |
| H4-resume | 0/8 use worker-list/inbox/run-use | 8/8 |
| S8-launch | no `term_` check / `.scratch` / `failedStage` | `.scratch/specs` 5/5, `term_` 4/5, `failedStage` 3/5 |
| All other S* and H* | pass | still pass (no regressions) |

**REFACTOR loop (1 iteration):** the first GREEN run caused a regression. In H5-silent, 3/5 opus runs planned `worker-stop` on a worker that was only silent ("if the nudge gets nothing back … worker-stop"). I added "Only Orca escalations carrying a stopReason start this ladder; silence … never do; an explicit user order is a trigger" plus an excuse row. Re-run: H5-silent 0/8 stop or replace; the `check --wait` mentions are all "no `check --wait`". New control H5-ordered (user explicitly orders the stop): 8/8 stop → confirm → `--retry-of`, so the fix did not over-correct.

Remaining: the S9 rereview still follows line 183 (as intended until E9 is verified). Astra still refuses S8 without tools.

## Split into stage files (control vs candidate)

Harness: `tests/git-gud/` (`run.py` and 25 scenarios from `scenarios.py`). Every call gets a `read` tool that serves the skill's files, and an Opus judge scores each answer against its rubric. Every FAIL was read by hand. Runs: 5 Opus + 3 Astra per scenario, 200 runs per arm.

| Arm | SKILL.md words | Total |
|---|---|---|
| Control: single file (2e33cf6) | 3,521 | 197/200 |
| Split v1 | 1,379 + 5 files | 193/200 |
| Split v2 (applied) | 1,436 + 5 files | 197/200 |

- **Split v1 regression:** S9-rereview went 0/3 on Astra. Astra treated a sub-file as weaker than pi-agents ("pi-agents… governs reuse despite final-review.md's conflicting worker-start wording"). T2-plan-review also went 1/3, with discovery-only answers.
- **v2 fix:** one paragraph saying the split files carry the skill's full authority and win over sub-skill defaults, and that agents should write real commands instead of `--help`. S9 returned to 3/3.
- **Remaining failures:**
  - Control: S8 Astra 1 refusal, T4 Astra 2 read-only answers.
  - v2: H5-ordered, T1, T2, each one Astra miss.
- **Loading:** the expected file was read in 8/8 runs for every scenario that has one, except the finish stage (S7/H7, 0/8). Those two passed anyway, because the core keeps the cleanup rules. H4-resume read `workers.md` in 5/8 runs, but SKILL.md already holds the resume list.
