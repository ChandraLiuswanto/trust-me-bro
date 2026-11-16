# git-gud: Replacing a Worker

Read when a finish notification says a worker **errored** or **was canceled** without a result, when a worker seems stuck or gone, or when the user orders a worker stopped or reassigned.

## Replacing a Worker

**No replacement editor while the old agent might still write.** A missing tab, a "running" status with no new activity, a stale timeline or a user saying "just give it to someone else" proves nothing about whether it stopped. Before any new worker touches that bead or its files:

1. `cancel_agent({ agentId })`, then `get_agent_status({ agentId })`. Continue only when the status is `idle`, `error` or `closed`. Anything else (still `running`/`initializing`, a tool error, unknown agent) is a blocker for the user.
2. `git -C <P> status --short`: commit or keep that lane's work; never discard it.
3. Hand off with one `create_agent` in the pipeline workspace (same routing row, a full handoff briefing per `pi-agents`, including the lane's partial work), then reassign the bead to the new `agentId` with `bd update`. Archive the old agent with `archive_agent`. Record the old and new agent IDs in the roster.

**Only finish notifications that report `errored` or `was canceled` without a usable result start this ladder.** Silence, elapsed time, an unchanged timeline, "no progress after the nudge" or an impatient user never do: inspect with `get_agent_status`/`get_agent_activity`, tell the user what you see, end the turn and let Paseo's finish notification wake you. Never poll (`get_agent_status`/`list_agents` loops, sleep loops, `paseo wait`). If the user explicitly orders a silent worker stopped, that order is the trigger; record it.

First `errored` notification from a worker: `get_agent_activity`, then ONE nudge with `send_agent_prompt`. A second `errored` notification for the same agent runs the three steps above. A third, or a replacement that also errors, goes to the user; never start a third worker. Reviewers get one nudge only and are never replaced.

| Excuse | Reality |
|---|---|
| "Its tab is gone, so it's dead" | Paseo may still report it running. Cancel and confirm first. |
| "Archive it and hand off in the same step" | Cancel, confirm the status, preserve the lane's work, then hand off. |
| "Three lanes are blocked waiting on it" | Blocked lanes are cheaper than two editors in one worktree. |
| "It made no progress after the nudge, so stop it" | Silence is not an `errored` notification. Wait for it or the user's explicit order. |
