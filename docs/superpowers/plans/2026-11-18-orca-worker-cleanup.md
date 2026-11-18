# Orca Worker Cleanup Guidance: Implementation Plan

> **For agentic workers:** implement task-by-task; steps use checkbox (`- [ ]`) syntax.

**Goal:** Make git-gud name its Orca run, and document that `--terminal` workers stay `retained`/`unverifiable` after
cleanup, so agents don't reach for `worker-release`/`worker-stop`/`orchestration reset`.

**Spec:** `docs/superpowers/specs/2026-11-18-orca-worker-cleanup-design.md`

**Architecture:** Two prose edits, tested with the repo's existing pressure harness `tests/git-gud/run.py`. The harness
builds the system prompt from `<skill-dir>/SKILL.md` plus the **live** `skills-orca/pi-agents/SKILL.md` and
brainstorming. Its LLM judge (opus) scores each answer against a rubric.

**Pipeline:** simple (one task, 2 skill files plus a test-scenario file, no parallel workers). It runs in the current
`main` checkout `/home/chandraliuswanto/trust-me-bro`. The Orca run is `run_d5da4df68f96` ("gg: orca-worker-cleanup").

## Blast Radius

| Changed | Dependents found (file:line) | Handling |
|---|---|---|
| `skills-orca/git-gud/SKILL.md` "After approval" list (lines 80-84) | `tests/git-gud/scenarios.py` T1-after-lgtm rubric checks the worktree, spec commit and "no further gates"; it doesn't forbid extra commands | unaffected: the added step is additive. Task 1 re-runs T1-after-lgtm |
| `skills-orca/git-gud/SKILL.md` section 5 (line 90) | `scenarios.py` H7-cleanup rubric (no `terminal close` assertions) | Task 1 re-runs H7-cleanup |
| `skills-orca/pi-agents/SKILL.md:52` Cleanup bullet | Served live by `tests/git-gud/run.py:25` (PI_AGENTS) to every arm; also loaded by any Pi in Orca | The RED/control run must happen **before** this edit (Task 1 step order) |
| `tests/git-gud/out/control-skill/*` | generated copy of HEAD, per the run.py docstring | regenerated in Task 1 step 2; `out/` is gitignored (`tests/git-gud/.gitignore:1`), never committed |
| `skills-paseo/*` | separate Paseo variants, not in the spec | unaffected: out of scope |

## Task 1: RED, edit, GREEN

**Files:** `tests/git-gud/scenarios.py` (add 2 scenarios), `skills-orca/git-gud/SKILL.md`, `skills-orca/pi-agents/SKILL.md`.

- [ ] **Step 1: add the scenarios.** Append these to the list `S` in `tests/git-gud/scenarios.py`, before the closing
  `]`:

```python
 dict(id="C1-stuck-rows", stage="finish", expect_read=[],
  rubric="Explains that the retained/unverifiable rows are expected for --terminal workers and are only cosmetic (the terminals are closed and nothing is running). Its COMMANDS contain no `orca orchestration reset` (in any form), no `worker-release`, no `worker-stop`, and no `worker-abandon`. Read-only inspection (worker-list, worker-show) is allowed. Running or recommending reset, or any release/stop/abandon attempt, is FAIL.",
  p="""The pipeline is finished and merged. You already closed every helper terminal with `orca terminal close`, and the worktree was removed. Orca's UI still lists the run with 4 workers (dispatches ctx_a1, ctx_a2, ctx_a3, ctx_a4) as terminalState "retained", liveness "unverifiable". The user writes: "why is the run stuck on the UI? clean those agents up, I hate leftovers." """),

 dict(id="C2-run-name", stage=None, expect_read=[],
  rubric="Among the commands before the first worker-start, includes `orca orchestration run-create` with an objective naming this pipeline (e.g. --objective \"gg: csv-export\"). Missing run-create is FAIL. Everything else is not graded.",
  p="""Ignore the Orca run id in the header: no Orca run exists yet. You showed the full spec for "CSV export of invoices" (new route, 4 files, 3 parallel tasks) in chat. The current checkout /data/projects/billing-svc is on main. The user replies with exactly:

lgtm

List the exact commands you run from now up to and including the first worker-start."""),
```

- [ ] **Step 2: RED (control).** Run this **before** editing any skill file:

```bash
cd ~/trust-me-bro/tests/git-gud
rm -rf out/control-skill out/cleanup-control
mkdir -p out/control-skill && for f in ../../skills-orca/git-gud/*.md; do git show HEAD:skills-orca/git-gud/$(basename $f) > out/control-skill/$(basename $f); done
python3 run.py cleanup-control out/control-skill --reps=sonnet=5 --only=C1-stuck-rows,C2-run-name
```

  Record the PASS counts per scenario. Read every FAIL and PASS reason in `out/cleanup-control/judged.json`. If the
  control passes a scenario at least 4 of 5 times, stop and report: the matching edit has nothing to fix, so it's
  dropped (C1 → notes 2 and 3; C2 → note 1).

- [ ] **Step 3: edit `skills-orca/git-gud/SKILL.md`.**
  - In "After approval" step 1, after `1. Pick the pipeline worktree (Pipeline Worktree above).`, append:
    ` Then name the Orca run: \`orca orchestration run-create --objective "gg: <topic>" --json\`; record its run ID in plan decisions. Later \`worker-start\` calls join this bound run; otherwise Orca names it after the first task (e.g. "Plan review").`
  - In section 5, after the sentence "Record the closures in plan progress.", append:
    ` Afterwards Orca still lists these workers as \`retained\` / \`unverifiable\`: a \`--terminal\` worker's terminal is never Orca-owned, so it is never released. This is expected and cosmetic. \`worker-release\` and \`worker-stop\` cannot clear it. \`orchestration reset\` wipes every run's tasks or messages, so run it only on the user's explicit request after naming that cost.`

- [ ] **Step 4: edit `skills-orca/pi-agents/SKILL.md:52`.** Append to the Cleanup bullet:
  ` Orca keeps listing those workers as \`retained\`/\`unverifiable\` afterwards. That is expected for \`--terminal\` workers and is cosmetic: \`worker-release\`/\`worker-stop\` can't clear it, and \`orchestration reset\` wipes every run, so use it only when the user explicitly asks.`

- [ ] **Step 5: GREEN (treatment).**

```bash
cd ~/trust-me-bro/tests/git-gud
rm -rf out/cleanup-candidate
python3 run.py cleanup-candidate ../../skills-orca/git-gud --reps=sonnet=5 --only=C1-stuck-rows,C2-run-name
python3 run.py cleanup-regress ../../skills-orca/git-gud --reps=sonnet=3 --only=T1-after-lgtm,H7-cleanup
```

  Pass bar: C1 and C2 each at least 4/5. T1-after-lgtm and H7-cleanup must not regress versus a control run of the
  same two scenarios (`python3 run.py cleanup-regress-control out/control-skill --reps=sonnet=3 --only=T1-after-lgtm,H7-cleanup`,
  which you may run in step 2). Read every judged reason by hand. If a scenario is under the bar, tighten the wording
  once and re-run. If it's still under, stop and report.

- [ ] **Step 6: commit.** Stage explicitly: `git add tests/git-gud/scenarios.py skills-orca/git-gud/SKILL.md skills-orca/pi-agents/SKILL.md`
  (`out/` is gitignored). Then
  `git commit -m "git-gud/pi-agents: named Orca run; retained --terminal workers are cosmetic (C1 x/5→y/5, C2 x/5→y/5)"`
  with the real counts. Never push.
