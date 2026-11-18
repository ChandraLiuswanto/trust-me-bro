# Orca Worker Cleanup Guidance: Implementation Plan

> **For agentic workers:** implement task-by-task; steps use checkbox (`- [ ]`) syntax.

**Goal:** Make git-gud name its Orca run, and document that `--terminal` workers stay `retained`/`unverifiable` after
cleanup, so agents don't reach for `worker-release`/`worker-stop`/`orchestration reset`.

**Spec:** `docs/superpowers/specs/2026-11-18-orca-worker-cleanup-design.md`

**Architecture:** Two prose edits, tested with the repo's existing pressure harness `tests/git-gud/run.py`. The harness
builds the system prompt from `<skill-dir>/SKILL.md` plus the **live** `skills-orca/pi-agents/SKILL.md` and
brainstorming. Its LLM judge (opus) scores each answer against a rubric.

**Pipeline:** not simple (4 files, parallel owners), so it runs in the worktree
`P=/home/chandraliuswanto/orca/workspaces/trust-me-bro/orca-worker-cleanup` on branch `gg/orca-worker-cleanup`. The
Orca run is `run_d5da4df68f96` ("gg: orca-worker-cleanup"). The spec and plan were first committed on `main`
(`ab2b5bd`, `7277c6e`) before the plan review reclassified the change. They stay there, because the user's `main` is
never rewritten. This branch starts from `7277c6e`.

**Baseline isolation:** `run.py:26` reads `pi-agents` from `~/trust-me-bro/skills-orca/...`, the main checkout, which
nobody edits during this run. So the control always sees the old `pi-agents`, and the treatment needs an override
(Task 1). The control's git-gud is `git show HEAD:` of the base commit. The RED baseline can therefore run at any time,
and the skill edits run in parallel with it.

## Blast Radius

| Changed | Dependents found (file:line) | Handling |
|---|---|---|
| `skills-orca/git-gud/SKILL.md` "After approval" list (lines 80-84) | `tests/git-gud/scenarios.py` T1-after-lgtm rubric checks the worktree, spec commit and "no further gates"; it doesn't forbid extra commands | unaffected: the added step is additive. Task 1 re-runs T1-after-lgtm |
| `skills-orca/git-gud/SKILL.md` section 5 (line 90) | `scenarios.py` H7-cleanup rubric (no `terminal close` assertions) | Task 1 re-runs H7-cleanup |
| `skills-orca/pi-agents/SKILL.md:52` Cleanup bullet | Served by `tests/git-gud/run.py:26` (PI_AGENTS, hard-coded to the main checkout) to every arm; also loaded by any Pi in Orca after merge | Task 3 edits it in P. Task 1 adds a `PI_AGENTS_FILE` env override, so Task 4 points the treatment at P's copy; the control keeps the main checkout's unedited copy |
| `tests/git-gud/run.py:26` PI_AGENTS | `build_system` (:60), `serve` (:70) | Task 1: `PI_AGENTS = Path(os.environ["PI_AGENTS_FILE"]) if set else <current>`; the default behaviour is unchanged |
| `tests/git-gud/out/control-skill/*` | generated copy of HEAD, per the run.py docstring | regenerated as `out/cw-control-skill` in Task 1 step 3; `out/` is gitignored (`tests/git-gud/.gitignore:1`), never committed |
| `skills-paseo/*` | separate Paseo variants, not in the spec | unaffected: out of scope |

## Tasks and ownership

| Task | Owns | Blocked by |
|---|---|---|
| 1. Scenarios, harness override, RED | `tests/git-gud/scenarios.py`, `tests/git-gud/run.py` | — |
| 2. git-gud edit | `skills-orca/git-gud/SKILL.md` | — |
| 3. pi-agents edit | `skills-orca/pi-agents/SKILL.md` | — |
| 4. GREEN and verdict | no new files; may tighten the Task 2/3 wording once | 1, 2, 3 |

Tasks 1, 2 and 3 run in parallel. Task 4 is done by Task 1's owner.

## Task 1: scenarios, harness override, RED (`tests/git-gud/scenarios.py`, `tests/git-gud/run.py`)

- [ ] **Step 1: add the scenarios.** Append these to the list `S` in `tests/git-gud/scenarios.py`, before the closing `]`:

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

- [ ] **Step 2: harness override.** In `tests/git-gud/run.py`, replace line 26 with:

```python
PI_AGENTS = pathlib.Path(os.environ["PI_AGENTS_FILE"]) if os.environ.get("PI_AGENTS_FILE") else HOME / f"trust-me-bro/skills-{HOSTSEL}/pi-agents/SKILL.md"
```

  Add one docstring line: `PI_AGENTS_FILE=<path> overrides the pi-agents SKILL.md (default: the main checkout's).`
  Check with `python3 -c "import ast;ast.parse(open('tests/git-gud/run.py').read())"` and the same command for
  `scenarios.py`.

- [ ] **Step 3: RED control.** Use immutable arm names and never reuse one.

```bash
cd /home/chandraliuswanto/orca/workspaces/trust-me-bro/orca-worker-cleanup/tests/git-gud
mkdir -p out/cw-control-skill && for f in $(git ls-tree --name-only 7277c6e skills-orca/git-gud/); do git show 7277c6e:$f > out/cw-control-skill/$(basename $f); done
python3 run.py cw-red out/cw-control-skill --reps=sonnet=5 --only=C1-stuck-rows,C2-run-name
python3 run.py cw-regress-control out/cw-control-skill --reps=sonnet=3 --only=T1-after-lgtm,H7-cleanup
```

  Do not set `PI_AGENTS_FILE` here: the control uses the main checkout's unedited `pi-agents`. Read **every response
  file** (`out/cw-red/*.json`, `answer` field) plus its judged reason, and note any judge errors. If C1 or C2 passes at
  least 4 of 5 in the control, report it in `worker_done`: that edit has nothing to fix (C1 → Tasks 2b and 3; C2 →
  Task 2a), and the coordinator decides.

- [ ] **Step 4: commit.** `git add tests/git-gud/scenarios.py tests/git-gud/run.py && git commit -m "tests/git-gud: C1/C2 cleanup scenarios, PI_AGENTS_FILE override"`.
  Report the RED counts.

## Task 2: git-gud edit (`skills-orca/git-gud/SKILL.md`)

- [ ] **2a.** In "After approval" step 1, after `1. Pick the pipeline worktree (Pipeline Worktree above).`, append:
  ` Then name the Orca run: \`orca orchestration run-create --objective "gg: <topic>" --json\`; record its run ID in plan decisions. Later \`worker-start\` calls join this bound run; otherwise Orca names it after the first task (e.g. "Plan review").`
- [ ] **2b.** In section 5, after "Record the closures in plan progress.", append:
  ` Afterwards Orca still lists these workers as \`retained\` / \`unverifiable\`: a \`--terminal\` worker's terminal is never Orca-owned, so it is never released. This is expected and cosmetic. \`worker-release\` and \`worker-stop\` cannot clear it. \`orchestration reset\` wipes every run's tasks or messages, so run it only on the user's explicit request after naming that cost.`
- [ ] Commit only this file: `git add skills-orca/git-gud/SKILL.md && git commit -m "git-gud: name the Orca run; retained --terminal workers are cosmetic"`.

## Task 3: pi-agents edit (`skills-orca/pi-agents/SKILL.md`)

- [ ] Append to the Cleanup bullet (line 52):
  ` Orca keeps listing those workers as \`retained\`/\`unverifiable\` afterwards. That is expected for \`--terminal\` workers and is cosmetic: \`worker-release\`/\`worker-stop\` can't clear it, and \`orchestration reset\` wipes every run, so use it only when the user explicitly asks.`
- [ ] Commit only this file: `git add skills-orca/pi-agents/SKILL.md && git commit -m "pi-agents: retained --terminal workers are cosmetic"`.

## Task 4: GREEN (Task 1's owner, after 1-3 are closed)

```bash
cd /home/chandraliuswanto/orca/workspaces/trust-me-bro/orca-worker-cleanup/tests/git-gud
export PI_AGENTS_FILE=/home/chandraliuswanto/orca/workspaces/trust-me-bro/orca-worker-cleanup/skills-orca/pi-agents/SKILL.md
python3 run.py cw-green ../../skills-orca/git-gud --reps=sonnet=5 --only=C1-stuck-rows,C2-run-name
python3 run.py cw-regress ../../skills-orca/git-gud --reps=sonnet=3 --only=T1-after-lgtm,H7-cleanup
```

- Pass bar: C1 and C2 each pass at least 4 of 5. `cw-regress` must pass at least as many as `cw-regress-control`
  for each scenario.
- Read **every response file** in `out/cw-green` and `out/cw-regress`, plus the judged reasons. Report any judge verdict
  you disagree with.
- If a scenario is under the bar, tighten the wording **once**, in the Task 2/3 file, as its own commit. Re-run under
  a **new** arm name (`cw-green2` / `cw-regress2`), never by reusing an old one. If it's still under, stop and report.
- Report a table in `worker_done`: scenario, RED, GREEN, regress-control vs. regress, plus every manual disagreement
  with the judge.
