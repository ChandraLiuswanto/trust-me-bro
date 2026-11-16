# git-gud: Replacing a Worker

Read when Orca escalates with a stopReason, when a worker seems stuck or gone, or when the user orders a worker stopped or reassigned.

## Replacing a Worker

**No replacement editor while the old dispatch might still write.** A missing terminal, a "running" status with no output, a stale screen or a user saying "just give it to someone else" proves nothing about whether it stopped. Before any new worker touches that bead or its files:

1. `orca orchestration worker-stop --dispatch <id> --json`, then `worker-show --dispatch <id> --json`. Continue only when it shows the dispatch stopped or failed. Anything else (`stop_unknown`, still running, an error) is a blocker for the user.
2. `git -C <P> status --short`: commit or keep that lane's work; never discard it.
3. Retry with `worker-start --task <task_id> --retry-of <id>` (repeat `--worktree`/`--terminal`; `--retry-of` does not inherit placement). Record the old and new dispatch IDs in the roster.

**Only Orca escalations carrying a stopReason start this ladder.** Silence, elapsed time, an unchanged screen, "no progress after the nudge" or an impatient user never do: inspect with `worker-show`/`worker-read`, tell the user what you see, end the turn and let Orca wake you. Never poll (`check --wait` loops, sleep loops). If the user explicitly orders a silent worker stopped, that order is the trigger; record it.

First stopReason escalation from a worker: `worker-show`, then ONE nudge with `send --to dispatch:<id>`. A second new stopReason on the same dispatch runs the three steps above. A third stopReason, a failed retry or Orca's retry breaker goes to the user; never start a third worker. Reviewers get one nudge only and are never replaced.

| Excuse | Reality |
|---|---|
| "Its terminal is gone, so it's dead" | Orca still records it as running. Stop and confirm first. |
| "Close it out with whatever verb `--help` lists, then hand off" | The verb is `worker-stop`, and the handoff waits for its confirmation. |
| "Three lanes are blocked waiting on it" | Blocked lanes are cheaper than two editors in one worktree. |
| "It made no progress after the nudge, so stop it" | Silence is not a stopReason. Wait for Orca's escalation or the user's explicit order. |
