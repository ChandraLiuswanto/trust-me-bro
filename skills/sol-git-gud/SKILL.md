---
name: sol-git-gud
description: Use when SoL-Pi is installed and the user hands over a vague or underspecified feature for autonomous, end-to-end delivery, especially long-running work likely to create large observations or context pressure.
---

# Sol-Git-Gud

Turn a rough idea into verified code with one spec-approval gate, autonomous execution, and bounded independent review. Integration remains the user's decision.

**Pipeline:** Brainstorm → approved spec → plan → one plan review → parallel beads → final review → at most one fix/re-review cycle → integration menu and WAIT.

Use for underspecified features the user wants delivered whole. For trivial fixes, use systematic-debugging and TDD; for user-led work, use brainstorming. An existing spec/plan permits starting later only when the spec has passed the approval gate below.

## Delegation and Workspace

**REQUIRED SUB-SKILL: `pi-agents`** for every worker and reviewer. It owns general lifecycle, profile discovery, context delivery and completion handling. Delegate through Paseo MCP, never generic Pi `Agent` or `SubagentWorkflow`; if Paseo or required workflow capabilities are unavailable, report a blocker rather than silently substitute tools.

Record one workspace ID and absolute checkout path for the pipeline, following `pi-agents`' Same-Workspace Pipelines contract. This overrides delegated skills' isolation defaults unless the user explicitly requests otherwise. Serialize overlapping edits, shared-output builds and Git mutations; freeze reviewed files during review. Preserve existing work. For legacy multi-worktree runs, report the mismatch and agree on safe consolidation before launching editors; never discard changes to enforce placement.

### Routing

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

Discover current profiles, models, modes and effort IDs before launch; never guess IDs. An otherwise suitable `claude` profile must be re-materialized as `pi/fedora/<model>` with compatible settings, not copied unchanged. Apply the table's effort, overriding profile defaults and updating reused agents when roles change. Unsupported effort requires a supported alternative; never silently use high, except to match the planner's effort for review, or change parent/global settings.

On confirmed Claude usage-limit failure, record it and stop creating or prompting Claude-family agents for the rest of the five-hour window; no quota probes or artificial work. Substitute Sol or Astra only where the task's row permits, at its required effort; otherwise report a blocker. For other route failures, disclose an eligible same-role substitution or report a blocker. Never broaden the matrix to work around availability.

### Ownership and Reuse

Reuse suitable idle owners before creating agents: normally one worker per active file lane and one independent reviewer. This overrides fresh-worker-per-task defaults. Original owners fix their findings; reviewers remain read-only and never approve their own implementation. Reuse the plan reviewer for final review when suitable.

Keep a compact roster in plan decisions: agent ID, role/effort, workspace, files/beads, reviewer, pending turn, processed completion, spec/plan revision and next action. **One pending work turn per agent.** Queue follow-ups for busy owners; do not interrupt or introduce a competing editor. Independent ready lanes still run concurrently: assign another suitable idle worker or create one for an uncovered lane. If an owner is unavailable or unsuitable, record why and hand off to a suitable non-reviewer without violating file isolation.

Bootstrap once with task, ownership, acceptance criteria, spec/plan paths and constraints. Follow-ups carry only changed findings, files, evidence and next action. Run `bd prime` initially, after confirmed context loss, or after a beads error—not on every turn. Each new bead still requires live ownership/dependency checks and an atomic claim; remembered context never authorizes task-state changes.

Accept current assistant conclusions from finish notifications or targeted activity reads, not tool traces, echoed prompts or stale results. Reject duplicate completions using recorded agent/turn and commit evidence. A late result cannot finish a newer turn; reconcile ambiguous identity before dispatching again. Report failed or incomplete results rather than treating silence as success. Missing review verdicts follow the blocker rule below, not an extra review request.

## Context Recovery

- Retrieve needed packed-output pages with `obs_recall` instead of rerunning commands to recover omitted output.
- After compaction, restore ownership, pending turns, processed completions and verification state from the plan, roster and repository evidence. Resume the existing work rather than restart; verify side effects before retrying.

## 1. Spec and Approval

**REQUIRED SUB-SKILL: superpowers:brainstorming.** Follow its checklist through refinement and self-review. Write requirements, success criteria and edge cases to `docs/superpowers/specs/YYYY-MM-DD-<topic>-design.md`. The later implementation plan is a separate file. Brainstorming supplies the spec review; do not add independent spec-hardening reviewers.

Its request to review the written spec is the single approval ask. The gate opens only when the **entire trimmed reply** to the presented spec is **`no cap`**, **`autopilot`**, or **`lgtm`**, case-insensitively. Mixed text such as “lgtm but rename X” or “not lgtm” is feedback: address it and re-present. “Looks good”, “approved”, or “go ahead” requires asking for a keyword. A keyword in the initial request pre-approves nothing.

After approval, initialize the complete active `update_plan`; keep one step in progress and record concise evidence at phase/bead boundaries. Run without plan approval, breakdown confirmation or progress check-ins. Stop only for an unresolvable blocker, genuine spec ambiguity, unavailable required capabilities, or the review blockers below. This autonomy does **not** authorize integration.

## 2. Plan and One Review

**REQUIRED SUB-SKILL: superpowers:writing-plans.** Write a separate implementation plan linking to the approved spec, then perform its self-review.

The plan MUST contain a `## Blast Radius` section, built from repository evidence (grep/LSP for callers, importers, subclasses, serializers, API clients, migrations, config, tests) before tasks are written. One row per changed symbol, schema, route, config key or shared file:

| Changed | Dependents found (file:line) | Handling |
|---|---|---|
| `fn/table/route` | every caller or consumer | `Task N` edits it · `Task N` adds a regression test · unaffected because <evidence> |

Every dependent ends in a task or an evidenced "unaffected". A dependent needing edits joins the ownership map like any other file.

Create one fresh independent Pi reviewer from the plan-review routing row. Use this calibrated prompt verbatim, substituting paths; do not turn it into an adversarial attack:

```
You are a plan document reviewer. Verify this plan is complete and ready for implementation.

**Plan to review:** [PLAN_FILE_PATH]
**Spec for reference:** [SPEC_FILE_PATH]

## What to Check

Completeness (TODOs, placeholders, missing steps) · Spec Alignment (covers every
requirement, no scope creep) · Task Decomposition (clear boundaries, actionable
steps) · Buildability (could an engineer follow this without getting stuck?) ·
Blast Radius (spot-check the changed symbols: a caller, consumer or contract the
plan's Blast Radius section misses, or an "unaffected" claim without evidence,
is an Issue)

## Calibration

**Only flag issues that would cause real problems during implementation.**
An implementer building the wrong thing or getting stuck is an issue.
Minor wording, stylistic preferences, and "nice to have" suggestions are not.

Approve unless there are serious gaps — missing requirements from the spec,
contradictory steps, placeholder content, or tasks so vague they can't be acted on.

## Also return a file-ownership map — BOTH halves are required

1. Tasks writing the same file with no dependency chaining them.
2. Tasks writing disjoint files, which MUST stay unblocked and run in parallel.

A fully serial chain is a FAILED review, not a safe one. Target shape: several
independent heads (one file owner each) feeding a chain only where a file is
genuinely shared.

## Output Format

**Status:** Approved | Issues Found

**Issues:** [Task X]: [issue] - [why it matters]

**File ownership:** collisions: ... | must-parallel: ...

**Recommendations (advisory, do not block approval):** ...
```

Exactly one reviewer and one round. Fix **Issues** inline before creating beads, including missing requirements. **Recommendations** are advisory: drop or report them, never implement them as extra scope. No second plan review and no human gate. An unusable review is a blocker, not permission to invent approval or reset the budget.

## 3. Beads and Parallel Implementation

Inside the recorded checkout:

```bash
bd init --stealth --non-interactive
A=$(bd create "Task A" --silent)
B=$(bd create "Task B" --silent)
bd dep "$A" --blocks "$B"  # B waits for A
```

Never use `--deps "blocks:A"`: that direction is reversed; the typed dependency is `blocked-by:A`. Build dependencies from the reviewed ownership map. Disjoint-file tasks remain unblocked; shared-file writers chain. Uncertainty about a specific pair may justify one dependency, not serializing the whole graph. If the first `bd ready` yields one bead despite several independent new-file tasks, fix over-serialization before dispatch.

Use superpowers:subagent-driven-development for implementation discipline, but override its fresh-agent and per-bead two-stage review defaults: reuse owners and **do not launch per-bead reviewers**. Dispatch independent ready lanes concurrently; blocked chains advance as blockers close. Each worker prompt requires:

- Check live task ownership and dependencies. Coordinator assigns with `bd update "$ID" --assignee "$AGENT_ID"`; worker atomically claims only assigned ready work with `bd --actor "$AGENT_ID" ready --assignee "$AGENT_ID" --claim --json`. If nothing is ready, wait; never take another owner's fix or bypass blockers.
- Follow TDD. Run task tests and commit each bead separately once green. Per-task commits remain the history; never squash them during autopilot.
- Stage only explicit task paths; never `git add -A` or `git add .` in the shared worktree. Serialize Git mutations. On `index.lock`, wait and retry; never delete it.
- Never push, pull, fetch or rebase.
- Close with `bd close "$ID"` only after green task tests and an existing task commit. These are bead exit criteria; no per-bead review is needed.

Recheck `bd ready` until no open beads remain. Tests attached to an edit prove only that command's scope; still perform the prescribed targeted and broad verification. Do not close blocked or failing work merely to reach final review.

## 4. Bounded Final Review

**Total budget: one plan review, one final review, at most one final re-review.** No stronger-model gate or additional deep pass. Reuse/replacement never resets this budget.

Use one suitable independent Pi reviewer from the final-review routing row, preferably the plan reviewer; create only if none qualifies. Supply the spec/plan paths, diff/base reference and test evidence. Review the whole implementation against the spec for correctness, code quality, regressions/tests and security/edge cases in one verdict. Freeze reviewed files until it returns. Record scope, reviewer, revision, verdict and rounds used.

Final review and optional re-review name their scope and return:

```
VERDICT: PASS | FAIL
FINDINGS:
- [Critical|Important|Minor] <file:line> — <what is wrong, evidence>
(or: - none)
```

Critical or Important findings force FAIL; Minor findings do not block. A missing or inconsistent verdict is a blocker: report and stop for the user's decision. Do not automatically request clarification, replace the reviewer, add rounds or silently assume PASS.

Route valid results mechanically:

- **Initial Critical/Important findings:** create fix beads, link coupled dependencies, and dispatch to original owners with green tests and task commits. Send the **same reviewer one follow-up** on its existing agent ID, carrying finding/fix deltas and affected invariants; broaden scope for cross-cutting changes.
- **Remaining or new Critical/Important findings after that re-review:** report unresolved blockers and stop for the user. No further autonomous fix/review cycle; integration is not ready.
- **Minor findings:** one tested, committed batched cleanup bead or report notes. No additional review round for nits.
- **Clean pass:** proceed to Finish, without another gate.

## 5. Finish and Wait

Give a concise summary of commits, tests and results, review outcomes/rounds, unresolved findings and blockers. Mention relevant routing substitutions or limitations. No fixed report template is required; do not hide failures behind a success summary.

**REQUIRED SUB-SKILL: superpowers:finishing-a-development-branch.** Verify tests, detect the environment and confirm the base branch. Present its integration options (merge locally / push + PR / keep as-is), then **STOP and wait for the user's choice**. Execute only the chosen option; push requires the user's explicit command. Spec approval and “no further gates” authorize implementation, not merging, touching the base branch or choosing integration for the user.
