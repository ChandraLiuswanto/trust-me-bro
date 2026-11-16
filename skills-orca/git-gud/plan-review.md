# git-gud: Plan and One Review

Read when starting stage 2, right after the spec is approved and committed.

## 2. Plan and One Review

**REQUIRED SUB-SKILL: superpowers:writing-plans.** Write a separate implementation plan linking to the approved spec, then perform its self-review.

The plan MUST contain a `## Blast Radius` section, built from repository evidence (grep/LSP for callers, importers, subclasses, serializers, API clients, migrations, config, tests) before tasks are written. One row per changed symbol, schema, route, config key or shared file:

| Changed | Dependents found (file:line) | Handling |
|---|---|---|
| `fn/table/route` | every caller or consumer | `Task N` edits it · `Task N` adds a regression test · unaffected because <evidence> |

Every dependent ends in a task or an evidenced "unaffected". A dependent needing edits joins the ownership map like any other file.

Create one fresh independent Pi reviewer from the plan-review routing row (`routing.md`). Use this calibrated prompt verbatim, substituting paths; do not turn it into an adversarial attack:

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
