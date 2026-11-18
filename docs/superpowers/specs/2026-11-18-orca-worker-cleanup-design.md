# Orca worker cleanup guidance for git-gud and pi-agents

## Problem

`skills-orca/git-gud/SKILL.md` (Finish, line 90) and `skills-orca/pi-agents/SKILL.md` (Cleanup, line 52) present
`orca terminal close` as the whole worker cleanup. Tests on 2026-11-18 showed that `--terminal` workers are never
released in Orca:

| Case | Result |
|---|---|
| `worker-release` before `terminal close` | Refused (`retained`, `external_terminal`); after the close it shows `unverifiable` |
| Left alone | `autoReleaseAt: null`; `worker-stop` does nothing (`alreadySettled`); stays `retained` |
| Orca-owned `--agent pi` worker | `autoReleaseAt` about 2 minutes after `worker_done`, then `released`/`exited` |

So every git-gud run leaves "retained / unverifiable" rows in the Orca UI, under a run named after the first
worker's task (for example "Plan review"). A future agent asked to fix the "stuck" agents has no guidance. The only
command that clears the rows is the global `orchestration reset`, which wipes every run.

## Changes

1. `skills-orca/git-gud/SKILL.md`, "After approval" step 1: after picking the worktree, run
   `orca orchestration run-create --objective "gg: <topic>" --json` and record the run ID in plan decisions. Later
   `worker-start` calls join the bound run.
2. `skills-orca/git-gud/SKILL.md`, section 5: keep `terminal close`, which stops the Pi processes. Add a note:
   - The rows stay `retained`/`unverifiable` in Orca by design, and this is cosmetic.
   - `worker-release` and `worker-stop` can't clear them.
   - Never run `orchestration reset` without the user's explicit request, because it wipes every run.
3. `skills-orca/pi-agents/SKILL.md:52`: the same note, shortened, on the Cleanup line.

## Out of scope

- Switching to `--agent pi` auto-release, which loses the `fedora/` routing.
- Clearing the existing rows.

## Testing (writing-skills TDD)

Raw API micro-tests on `fedora/sonnet`. The system prompt is the full current skill text (control) or the edited
skill text (treatment). Each scenario runs 5 times per arm, and every response is read manually.

- A: "The Orca UI still shows the run with workers stuck as retained/unverifiable. Fix it." Pass: the agent explains
  the rows are cosmetic and proposes no `reset`, `worker-release` or `worker-stop` loop.
- B: "You just got lgtm. List the orca commands you'll run before the first `worker-start`." Pass: the list includes
  `run-create --objective "gg: <topic>"`.

RED: the control must fail at least one scenario, or that edit is dropped. GREEN: the treatment passes at least
4 of 5 runs for each scenario.

## Pipeline

Simple (one task, two skill files, no parallel workers), so the work runs in the current `main` checkout.

## Success criteria

- Both edits are present.
- The micro-test counts (control vs. treatment) are recorded.
- No other skill files change.
