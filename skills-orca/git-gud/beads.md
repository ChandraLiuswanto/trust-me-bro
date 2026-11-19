# git-gud: Beads and Parallel Implementation

Read before any `bd` command and before deciding the run is done.

## 3. Beads and Parallel Implementation

Inside the recorded checkout (run every bd call as `cd <P> && bd …`; `bd -C` fails before a database exists):

```bash
cd <P>
out=$(bd where 2>&1); rc=$?
# rc=0: reuse the database. Never re-init: a second init prints "Aborting." and exits 0.
# Output contains "No active beads workspace found": bd init --stealth --non-interactive
# Anything else (connection refused, permission, …): blocker. Report it; do not init.
L="gg:<topic>-$(date +%Y%m%d%H%M)-$(openssl rand -hex 2)"   # this run's label; record it in plan decisions
A=$(bd create "Task A" -l "$L" --silent)
B=$(bd create "Task B" -l "$L" --silent)
bd dep "$A" --blocks "$B"  # B waits for A
```

Every bead this run creates (tasks, fixes, cleanup) carries `-l "$L"`. Write the literal label into worker specs; workers do not have `$L`. The database may already hold beads from earlier runs; filter by `$L`, never by topic alone. In a worktree, the database lives in the main checkout's `.beads/`, so removing the worktree does not delete beads.

Never use `--deps "blocks:A"`: that direction is reversed; the typed dependency is `blocked-by:A`. Build dependencies from the reviewed ownership map. Disjoint-file tasks remain unblocked; shared-file writers chain. Uncertainty about a specific pair may justify one dependency, not serializing the whole graph. If the first `bd ready` yields one bead despite several independent new-file tasks, fix over-serialization before dispatch.

Use superpowers:subagent-driven-development for implementation discipline, but override its fresh-agent and per-bead two-stage review defaults: reuse owners and **do not launch per-bead reviewers**. Dispatch independent ready lanes concurrently; blocked chains advance as blockers close. Each worker prompt requires:

- Check live task ownership and dependencies. The actor ID is the worker's handle: the `terminal` field of the `worker-start` JSON (`structworker_…`, stable across follow-ups), `$ORCA_TERMINAL_HANDLE` inside the worker. The coordinator assigns with `bd update "$ID" --assignee "<handle>"`. The worker takes only assigned ready work: `bd ready --assignee "$ORCA_TERMINAL_HANDLE" --json` lists it. Then claim one ID with `bd --actor "$ORCA_TERMINAL_HANDLE" update "$ID" --claim --json`. `ready --claim` cannot be combined with `--assignee`. If nothing is ready, wait; never take another owner's fix or bypass blockers.
- Follow TDD. Run task tests and commit each bead separately once green. Per-task commits remain the history; never squash them during autopilot.
- Stage only explicit task paths; never `git add -A` or `git add .` in the shared worktree. Serialize Git mutations. On `index.lock`, wait and retry; never delete it.
- Never push, pull, fetch or rebase.
- Message the coordinator mid-turn only for a blocker or a fact another lane needs now (`orca orchestration ask` for a blocker, or `orca orchestration send --type escalation` for a fact another lane needs); never for progress, commit notices or review requests. Everything else goes in the `worker_done` body, which Orca's injected preamble requires.
- Close with `bd close "$ID"` only after green task tests and an existing task commit. These are bead exit criteria; no per-bead review is needed.

**Done-check** before final review: `cd <P> && bd list -l "$L" --all -n 0 --json`. The run is done only when every bead in it is `closed`. An open, in_progress, blocked or deferred bead means it is not done. An empty `bd ready` never means done: it hides in_progress and blocked beads, and a plain `bd list` hides closed beads and stops at 50 rows. Tests attached to an edit prove only that command's scope; still perform the prescribed targeted and broad verification. Do not close blocked or failing work merely to reach final review.
