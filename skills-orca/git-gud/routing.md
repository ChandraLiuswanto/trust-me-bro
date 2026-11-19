# git-gud: Routing and Ownership

Read before creating or reusing any worker or reviewer terminal, or changing a worker's model/effort.

## Routing

Every delegated agent is a **Pi** worker on a **`fedora/`** model. Start it with `worker-start --agent pi --model fedora/<model> --effort <effort>` (see `pi-agents`); a bare `--agent pi` runs Pi's default model. Pi's `fedora` provider is the 9Router gateway, and every family, Claude included, runs through it. Never use Orca's `claude`/`codex` agents or a bare model ID. The parent may use any provider.

The current orchestrator handles brainstorming/spec, implementation planning, coordination and final summary; keep its model and effort unchanged. The table governs delegated work. Sol means **GPT-6.1 Sol**; Astra means **GPT-6 Astra**.

| Task | Default | Alternatives | Effort |
|---|---|---|---|
| Independent plan review | Astra | Fable 5.1 | At least the planner's effort |
| Complex implementation | Opus 5.5 · Sol | Astra · Fable 5.1 | Defaults: medium; alternatives: low only under the condition below |
| Security, difficult debugging, ambiguous cross-cutting work | Opus 5.5 | Astra · Fable 5.1 | Medium |
| Simple, bounded, low-risk implementation, tests or docs | Sonnet 5.5 | Sol | Low |
| Final review and optional re-review | Astra | Fable 5.1 | At least the planner's effort |
| Review fixes | Original implementation owner | Suitable replacement if needed | Match task complexity |

Astra/Fable low is eligible for complex implementation only when the task is well-specified, decomposed and backed by strong tests. Security, difficult debugging and ambiguous cross-cutting tasks use their dedicated medium-effort row regardless of decomposition or tests.

Choose one eligible model per assignment based on fit and availability; no family-percentage quota or mandatory Astra/Fable turn. Prefer cross-family review contrast when practical. When task complexity changes, re-evaluate the row and effort; update a suitable owner or hand off with ownership and context recorded. Original ownership never overrides routing eligibility.

Launch exactly as `pi-agents` shows (`worker-start --agent pi --model … --effort …`), with these pipeline specifics: record the returned `dispatchId` and `taskId`; spec files go in `<P>/.scratch/specs/<role>-<bead>.md`; if `worker-start` exits non-zero, do not rerun it: read `failedStage` from its JSON and follow the orchestration recovery reference.

Before launching, find the current model IDs with `pi --list-models fedora`; never guess IDs. Thinking levels are `off|minimal|low|medium|high|xhigh|max`. Apply the table's effort through `--effort`. A follow-up keeps the worker's model and effort; when a role needs a different model or effort, start a new worker for it. Unsupported effort requires a supported alternative; never silently use high, except to match the planner's effort for review, or change parent/global settings.

On confirmed Claude usage-limit failure, record it and stop creating or prompting Claude-family agents for the rest of the five-hour window; no quota probes or artificial work. Substitute Sol or Astra only where the task's row permits, at its required effort; otherwise report a blocker. For other route failures, disclose an eligible same-role substitution or report a blocker. Never broaden the matrix to work around availability.

## Ownership and Reuse

Reuse suitable idle owners before creating agents: normally one worker per active file lane and one independent reviewer. This overrides fresh-worker-per-task defaults. Original owners fix their findings; reviewers remain read-only and never approve their own implementation. Reuse the plan reviewer for final review when suitable.

Keep a compact roster in plan decisions: last dispatch ID, task ID, model, role/effort, worktree, files/beads, reviewer, pending turn, processed completion, spec/plan revision and next action. **One pending work turn per agent.** Queue follow-ups for busy owners; do not interrupt or introduce a competing editor. Independent ready lanes still run concurrently: assign another suitable idle worker or create one for an uncovered lane. If an owner is unavailable or unsuitable, record why and hand off to a suitable non-reviewer without violating file isolation.

Bootstrap once with task, ownership, acceptance criteria, spec/plan paths and constraints. Follow-ups carry only changed findings, files, evidence and next action. Run `bd prime` initially, after confirmed context loss, or after a beads error—not on every turn. Each new bead still requires live ownership/dependency checks and an atomic claim; remembered context never authorizes task-state changes.

Accept current assistant conclusions from `worker_done` mail (via `orca orchestration check`) or `worker-read --dispatch <id>`, not tool traces, echoed prompts or stale results. Reject duplicate completions using recorded dispatch ID, task ID and commit evidence. A late result cannot finish a newer turn; reconcile ambiguous identity before dispatching again. Report failed or incomplete results rather than treating silence as success. Missing review verdicts follow the blocker rule in `final-review.md`, not an extra review request.
