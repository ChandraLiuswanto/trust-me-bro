# git-gud: Routing and Ownership

Read before creating or reusing any worker or reviewer agent, or changing a worker's model/effort.

## Routing

Every delegated agent uses Paseo provider **`pi`** with a **`fedora/`** model: pass `provider: "pi/fedora/<model>"` (e.g. `pi/fedora/opus`, `pi/fedora/sol`, `pi/fedora/astra`). Pi's `fedora` provider is the 9Router gateway; every family, Claude included, runs through it — never the Claude Code provider or a bare model ID. The parent may use any provider.

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

Launch with one codemode `tools.mcp__paseo__create_agent` call per agent (several in one script with `Promise.allSettled`): `title`, `provider: "pi/fedora/<model>"`, `workspaceId: <pipeline workspace>`, `initialPrompt`, `settings: { thinkingOptionId: "<effort>" }`; leave `notifyOnFinish` on. There is no `profile` argument. Long worker briefs go in `<P>/.scratch/specs/<role>-<bead>.md`, referenced from the prompt. Discover current profiles, models, modes and effort IDs before launch; never guess IDs. An otherwise suitable `claude` profile must be re-materialized as `pi/fedora/<model>` with compatible settings, not copied unchanged. Apply the table's effort, overriding profile defaults and updating reused agents when roles change. Unsupported effort requires a supported alternative; never silently use high, except to match the planner's effort for review, or change parent/global settings.

On confirmed Claude usage-limit failure, record it and stop creating or prompting Claude-family agents for the rest of the five-hour window; no quota probes or artificial work. Substitute Sol or Astra only where the task's row permits, at its required effort; otherwise report a blocker. For other route failures, disclose an eligible same-role substitution or report a blocker. Never broaden the matrix to work around availability.

## Ownership and Reuse

Reuse suitable idle owners before creating agents: normally one worker per active file lane and one independent reviewer. This overrides fresh-worker-per-task defaults. Original owners fix their findings; reviewers remain read-only and never approve their own implementation. Reuse the plan reviewer for final review when suitable.

Keep a compact roster in plan decisions: agent ID, role/effort, workspace, files/beads, reviewer, pending turn, processed completion, spec/plan revision and next action. **One pending work turn per agent.** Queue follow-ups for busy owners; do not interrupt or introduce a competing editor. Independent ready lanes still run concurrently: assign another suitable idle worker or create one for an uncovered lane. If an owner is unavailable or unsuitable, record why and hand off to a suitable non-reviewer without violating file isolation.

Bootstrap once with task, ownership, acceptance criteria, spec/plan paths and constraints. Follow-ups carry only changed findings, files, evidence and next action. Run `bd prime` initially, after confirmed context loss, or after a beads error—not on every turn. Each new bead still requires live ownership/dependency checks and an atomic claim; remembered context never authorizes task-state changes.

Accept current assistant conclusions from finish notifications or targeted activity reads, not tool traces, echoed prompts or stale results. Reject duplicate completions using recorded agent/turn and commit evidence. A late result cannot finish a newer turn; reconcile ambiguous identity before dispatching again. Report failed or incomplete results rather than treating silence as success. Missing review verdicts follow the blocker rule in `final-review.md`, not an extra review request.
