---
name: git-gud
description: Use when Pi runs inside Orca with SoL-Pi installed and the user hands over a vague or underspecified feature for autonomous, end-to-end delivery, especially long-running work likely to create large observations or context pressure.
---
# Git-Gud (Orca)

Turn a rough idea into verified code with one spec-approval gate, autonomous execution, and bounded independent review. Integration remains the user's decision.

**Pipeline:** Brainstorm → approved spec → plan → one plan review → parallel beads → final review → at most one fix/re-review cycle → integration menu and WAIT.

Use for underspecified features the user wants delivered whole. For trivial fixes, use systematic-debugging and TDD; for user-led work, use brainstorming. An existing spec/plan permits starting later only when the spec has passed the approval gate below.

## Files and Stages

This skill is split. **Before acting in a stage, `read` its file** (same directory as this SKILL.md). Spec approval, worktree choice, context recovery and finish are in this file.

The split files are part of this skill and carry its full authority: where they differ from `pi-agents`, brainstorming or another sub-skill's defaults, the git-gud file wins (for example, the final re-review is a new `worker-start` on the reviewer's existing terminal, not a `send`). When a stage needs commands, write the actual commands from its file; do not substitute `--help` discovery.

| Stage / event | Read first |
|---|---|
| 1. Spec and approval; picking the worktree | this file |
| Launching, reusing or re-routing any worker or reviewer | `routing.md` |
| 2. Plan, Blast Radius, the one plan review | `plan-review.md` and `routing.md` |
| 3. Any `bd` command, dispatching lanes, the done-check | `beads.md` |
| An Orca escalation with a stopReason; a silent, stuck or missing worker; the user says stop/replace a worker | `workers.md` |
| 4. Final review, re-review, Minor fixes | `final-review.md` |
| 5. Finish and cleanup | this file and `beads.md` |

When you initialize `update_plan` after approval, start each step's goal with the file to read, e.g. "Read plan-review.md, routing.md: plan + one review", "Read beads.md: create beads, dispatch lanes", "Read beads.md, workers.md: implementation until done-check passes", "Read final-review.md: final review", "Finish". After compaction, re-read the in-progress step's file before acting.

**Hard rules (the files give the full procedure):**

- Nothing is created before the exact `lgtm`/`LGTM` reply (section 1).
- Workers: Pi on `fedora/` models only, via `terminal create --command "pi --model fedora/<m> --thinking <e>"` → `terminal wait --for tui-idle` → `worker-start --terminal`. Never `worker-start --agent pi --model`.
- Never replace a worker without a confirmed `worker-stop`; silence is not a stopReason; never poll. Reviewers are never replaced.
- Every bead carries this run's unique label; never `bd init` on an error other than "No active beads workspace found"; done means every labelled bead is `closed` (`bd list -l "$L" --all -n 0 --json`).
- One plan review, one final review, at most one re-review. Minor fixes after it: at most 3, ≤20 lines each, ≤60 total.
- Never push, merge or choose integration for the user.

## Delegation and Worktree

**REQUIRED SUB-SKILL: `pi-agents`** for every worker and reviewer. It owns launch, model selection, context delivery and completion handling. Delegate only through Orca orchestration workers (`orca orchestration worker-start`). Never use `pi -p`/`pi --mode rpc` subprocesses or generic Pi `Agent`/`SubagentWorkflow`. If Orca orchestration or a required workflow capability is unavailable, report a blocker instead of quietly substituting another tool.

Record the pipeline worktree (see Pipeline Worktree) by its ID and absolute checkout path, following the Same-Worktree Pipelines contract in `pi-agents`. Every `terminal create` and `worker-start` passes `--worktree path:<pipeline path>`. Never use `new-child`/`new-top-level` per stage or bead. This overrides delegated skills' isolation defaults unless the user explicitly requests otherwise. Serialize overlapping edits, shared-output builds and Git mutations; freeze reviewed files during review. Preserve existing work. For legacy multi-worktree runs, report the mismatch and agree on safe consolidation before launching editors; never discard changes to enforce placement.

## Pipeline Worktree

The pipeline never runs in a checkout on the default branch (`main`, `master`, or the target of `origin/HEAD`). Only after the spec gate opens (section 1), run `git branch --show-current` and pick exactly one row, judging "simple" from the approved spec:

| Current checkout | Pipeline worktree |
|---|---|
| Default branch, change not simple | Create one: `orca worktree create --name <topic> --branch gg/<topic> --base-branch <default> --json`. Record its worktree ID and absolute path. |
| Non-default branch | The current worktree. |
| Default branch, change simple | The current checkout. Record `simple: <reason>` in plan decisions. |

**Simple** means all of the following: one task, at most two files, no schema/migration/route/public-contract change, and no parallel workers. Anything else counts as not simple.

Running `git switch -c` inside the default-branch checkout does not meet this rule, because the user's checkout must stay on its branch. Write the spec, plan, beads and every commit inside the pipeline worktree, and run your own commands there (`git -C <path>`, `cd <path> &&`). Create the worktree once per pipeline, never per stage or bead.

## Context Recovery

- Retrieve needed packed-output pages with `obs_recall` instead of rerunning commands to recover omitted output.
- After compaction, restore ownership, pending turns, processed completions and verification state from the plan, roster and repository evidence. Resume the existing work rather than restart; verify side effects before retrying.
- After an Orca restart or a fresh coordinator, read before acting: `git -C <P> status` and `git -C <P> log main..HEAD`, `orca orchestration run-use --id <run>`, `worker-list --run <run>`, `worker-show`/`worker-read --dispatch <id>` per roster entry, `inbox --terminal run:<run> --limit 50 --full`, and the bead done-check (`beads.md`). Retry only dispatches proven stopped or failed (see `workers.md`).

## 1. Spec and Approval

**REQUIRED SUB-SKILL: superpowers:brainstorming.** Follow its checklist through refinement and self-review, with requirements, success criteria and edge cases. Brainstorming supplies the spec review; do not add independent spec-hardening reviewers.

**Nothing is created before approval.** Show the full spec in chat and ask for approval there. Until the gate opens, the only state you change is `update_plan`: no files (not even `.scratch`), no git-exclude edits, no commits, branches, worktrees, beads, terminals or workers. This overrides brainstorming's "write the spec to `docs/superpowers/specs/` and commit it" step and the Pipeline Worktree ordering: the spec file is written only after approval.

| Excuse | Reality |
|---|---|
| "Brainstorming requires a committed spec for the user to review" | Here the user reviews the spec in chat. The file comes after approval. |
| "Writing the spec in a worktree is not building" | A worktree, branch or commit before approval is work done ahead of the gate. |
| "The user said get everything ready while they're away" | Ready means the spec in chat. The gate opens only on the approval reply. |

**The gate** opens only when the **entire trimmed reply** to the latest presented spec is exactly **`lgtm`** or **`LGTM`**. Anything else is feedback: other spellings (“Lgtm”), “approved”, “looks good”, “no cap”, “not lgtm”, “lgtm but rename X”, “Lgtm, ship it”. Address it, re-present the spec, and say that a reply of exactly `lgtm` starts the run. A keyword in the initial request pre-approves nothing.

**After approval**, in order:

1. Pick the pipeline worktree (Pipeline Worktree above).
2. Write the spec to `<P>/docs/superpowers/specs/YYYY-MM-DD-<topic>-design.md` and commit it there. The implementation plan is a separate later file.
3. Show the remaining stages once and say: “No further human approval gates before integration; blockers still stop execution.”

Then initialize the complete active `update_plan`; keep one step in progress and record concise evidence at phase/bead boundaries. Run without plan approval, breakdown confirmation or progress check-ins. Stop only for an unresolvable blocker, genuine spec ambiguity, unavailable required capabilities, or the review blockers below. This autonomy does **not** authorize integration.

## 5. Finish and Wait

Before presenting integration options, close every helper terminal in the roster with `orca terminal close --terminal <H> --json` (workers, reviewers and fix owners). Never close your own `$ORCA_TERMINAL_HANDLE`. Record the closures in plan progress.

Give a concise summary of commits, tests and results, review outcomes/rounds, unresolved findings and blockers. Mention relevant routing substitutions or limitations. No fixed report template is required; do not hide failures behind a success summary.

**REQUIRED SUB-SKILL: superpowers:finishing-a-development-branch.** Verify tests, detect the environment and confirm the base branch. Present its integration options (merge locally / push + PR / keep as-is), then **STOP and wait for the user's choice**. Execute only the chosen option; push requires the user's explicit command. Spec approval and “no further gates” authorize implementation, not merging, touching the base branch or choosing integration for the user.
