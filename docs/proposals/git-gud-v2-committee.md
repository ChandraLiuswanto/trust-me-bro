# git-gud v2: committee review result

Three-round committee: Astra (fedora/astra, high), Opus (fedora/opus, high), Kimi (fedora/kimi, high). Run `run_ca12a9c6398b`.
This file supersedes the corresponding parts of `git-gud-v2.md`. Line numbers refer to `skills-orca/git-gud/SKILL.md` at commit `1461916`.

## Final verdicts

| Item | Verdict | Agreement |
|---|---|---|
| E1 approval gate | REVISE | 3/3 |
| E2 worktree after approval | KEEP, plus fix line 32 | 3/3 |
| E3 beads + run label | REVISE | 3/3; Astra's label-suffix objection adopted |
| E4 state file | REVISE (pointer file only) | 3/3; Astra's breaker wording fix adopted |
| E5 idle workers | REVISE | 2/3 on the stop ladder (Astra objects) |
| E6 unreviewed small fixes | REVISE (Minor only) | 3/3 |
| E7 cleanup | REVISE | 3/3 |
| E8 launch block | REVISE | 3/3 |
| D1 delete old copy | REVISE (preserve it first) | 3/3 |
| E9 re-review via send (new) | ADD | 3/3 |
| E10 show the stage again on resume (new) | ADD | 3/3 |

## Final wording per item

**E1.** Replace line 76; don't add a rule beside it.
- **The gate:** it opens only when the entire trimmed reply to the latest shown spec is exactly `lgtm` or `LGTM`. Other spellings ("Lgtm", "approve", "looks good"), negations ("not lgtm"), mixed text ("lgtm but rename X"), quotes and a keyword in the initial request don't count; treat them as feedback and present the spec again. This replaces line 76's `no cap` / `autopilot` / `lgtm` set (user decision).
- **Before approval:**
  - Show the spec in chat and do the builder check inline.
  - `update_plan` is allowed as session state only.
  - Make no repository, bd or Orca changes: no files, `.scratch`, git-exclude edits, branches, worktrees, beads or workers.
  - This overrides brainstorming's write and commit step and its worker-based checks.
- **After approval:**
  - Write and commit the spec file.
  - Show the remaining stages once and say: "No further human approval gates before integration; blockers still stop execution."
  - Kimi's proposed plan-review gate is rejected, because line 138 says "no human gate".

**E2.** Keep. Also remove the line 32 fallback, "move docs already written in the default checkout". Choose the simple or non-simple row from the approved spec.

**E3.**
- **Commands:** pass `bd -C <P>` on every bd call.
- **Database:**
  - Run `out=$(bd -C <P> where 2>&1)`.
  - Initialize with `bd -C <P> init --stealth --non-interactive` only when the output says "No active beads workspace found".
  - Treat any other failure as a blocker.
  - A second `bd init` prints "Aborting." and exits 0, so never re-initialize.
- **Run label:** `gg:<topic>-<YYYYMMDDHHMM>-<4 hex>`. The random suffix prevents collisions. Store it in the state file and write it literally into every worker spec; workers have no `$L`.
- **Labeling:**
  - Every bead this run creates (initial, fix or cleanup) carries `-l <L>`.
  - Record the IDs that `bd create --silent` prints.
  - After each batch, compare those IDs with `bd list -l <L> --all -n 0 --json`.
- **Done-check:** any bead under `bd list -l <L> --all -n 0 --json` that isn't closed (open, in_progress, blocked or deferred) means the run isn't done. An empty `bd ready` never means done; it caps at 100 and hides in_progress and blocked beads.
- **Known gap:** concurrent runs on one Dolt database are untested.

**E4.**
- **The file:** `<P>/.scratch/gg-state.json`.
  - Git-exclude `.scratch/` after approval.
  - The file is a pointer index only: bd, git and Orca stay the authorities.
- **Fields:**
  - `run_id`
  - worktree ID and path
  - branch and base
  - `label`
  - spec and plan paths
  - `approved_at`
  - `plan_review_used` and `final_review_rounds`
  - `unreviewed_fixes[]`
  - processed dispatch IDs
- **Writing:** the coordinator is the only writer and replaces the file atomically. It writes after approval, on each review transition and on each processed completion.
- **Finding the run:** a fresh coordinator finds it through branch `gg/<topic>` (`orca worktree list --json`).
- **Resume:**
  1. `git -C <P> status`
  2. `orca orchestration run-use --id <run>`
  3. `worker-list --run <run>`
  4. `worker-show` and `worker-read --dispatch <id>`
  5. `inbox --terminal run:<run> --limit 50 --full`
  6. `bd list -l <L> --all -n 0 --json`
- **Retry:** only attempts that live worker state proves settled and failed, via `worker-start --task <id> --retry-of <dispatch>`. Respect Orca's breaker: it trips after three failed starts in one `--retry-of` chain.
- **Reconcile:** on resume only, not at every stage.

**E5.**
- **Workers:**
  - Run long commands through the `process` tool.
  - Never send `worker_done` while a background process the worker still needs is running.
- **Coordinator:** remove `check --wait`. End the turn after dispatching and never poll. Silence alone never leads to a stop, retry or reassignment, and no timer authorizes anything.
- **First escalation with a stopReason:** run `worker-show` (observation.agentWait), then send ONE nudge with `send --to dispatch:<id>`.
- **Second escalation** (majority version, Opus and Kimi). It must be a new stopReason on the same dispatch after the nudge; ignore redeliveries, deduplicating by dispatch ID.
  1. Run `worker-stop --dispatch <id>`.
  2. Continue only if the stop is confirmed.
  3. Check `git -C <P> status`, then keep or commit that lane's work.
  4. Retry on the same Task with `--retry-of`, or reassign the bead with `bd update --assignee` using the E8 launch.
  5. Record the change.
- **Goes to the user as a blocker:** a `stop_unknown` result, a third stopReason, or a tripped breaker.
- **Astra's minority view:** a second stopReason always goes to the user, with no automatic stop.
- **Reviewers:** one nudge, which must not ask for another review. After that, a missing verdict is a blocker for the user, and the reviewer is never replaced.

**E6.** Merge this into the existing "Minor findings" bullet (around line 185) rather than adding a new section:
- **Eligible:** Minor findings only. Critical and Important findings never qualify; the existing stop at line 186 still applies.
- **Caps:** at most 20 changed lines per fix, and at most 3 fixes and 60 lines per run. Measure with `git diff --numstat`, adding insertions and deletions. No splitting or minification.
- **Conditions:** each fix gets its own commit, and the full suite must pass.
- **Reporting:** list the fixes under "Unreviewed changes" with each finding and commit, and mark those commits "not independently reviewed".
- **Effect:** incident #6 (an Important fix applied without review) now becomes an explicit stop.

**E7.**
- **Terminals:**
  - Owners and reviewers stay open until the Finish step, because owners fix findings and the plan reviewer is reused.
  - Exception: a confirmed-settled, owned worker with no further role may be closed once its result is recorded.
  - Failed starts are cleaned up with `worker-release`, not `terminal close`.
  - Never close the coordinator's own terminal, a kept-open terminal or one the user has taken over.
- **Beads:**
  - List them with `bd list -l <L> --all -n 0 --json`.
  - Validate each ID against its exit criteria (tests passing and committed).
  - Then run `bd close <ids...> --reason ...` with explicit IDs.
  - `bd close` has no `-l` flag, and without an ID it closes the last-touched bead.
  - Never mass-close unresolved beads.
- **Worktree:**
  - Run `orca worktree rm --worktree path:<P>` (or the recorded full ID) only when the user says so, only for a worktree git-gud created, and from outside that worktree.
  - `--delete-branch` needs separate, explicit approval, because it can delete branches that existed before the worktree. Check the receipt.
  - State that this overrides pi-agents' "never remove the worktree" and finishing-a-development-branch's `git worktree remove` step.

**E8.** Copy the pi-agents sequence verbatim:
1. `terminal create --worktree "path:<P>" --title "<role> · fedora/<m>" --command "pi --model fedora/<m> --thinking <e>" --json`
2. Parse the handle with the pi-agents python one-liner. Validate that it's non-empty and starts with `term_`.
3. `terminal wait --terminal "$H" --for tui-idle --timeout-ms 90000`
4. `worker-start --worktree "path:<P>" --terminal "$H" --task-title ... --spec-file <P>/.scratch/specs/<x>.md --json`
5. Record the receipt, handle failures by `failedStage`, and end the turn after independent dispatches.

Add a note on `--from`: send, ask, reply and worker-start accept it; check and terminal create/close do not.

**D1.** `~/Desktop/hackaton_adm/.agents/skills/sol-git-gud` is its own repo (origin ChandraLiuswanto/sol-git-gud) with an uncommitted change to SKILL.md, and `sol-git-gud-hackathon` declares "REQUIRED BASE SKILL: sol-git-gud". Before deleting:
1. Commit or archive the change and keep the repo history. Push only if the user agrees.
2. Point `sol-git-gud-hackathon` at git-gud, or retire it.
3. Afterwards, grep for leftover `sol-git-gud` references.

**E9 (new).** Change the line 183 re-review from "new worker-start on its existing terminal handle" to `send --to dispatch:<reviewer dispatch>`. It still counts as the single re-review.

**E10 (new).** After any resume, show the current stage again and keep it in `update_plan`.

## User decision
- E1's approval word: the user chose exactly `lgtm` or `LGTM` instead of `approve`.
- E5's second-stopReason rule: the user chose the majority version (an automatic stop, guarded as above).
