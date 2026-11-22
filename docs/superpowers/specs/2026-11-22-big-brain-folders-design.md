# big-brain: type folders, no-history rule, rebuild

**Status:** Approved (since 2026-11-22 12:38 WIB)

## Problem

1. **Wikis fill with session history.** The new_bsa_react import wrote worktree paths, branches, commit hashes, test
   counts and review narration. The micro-test (below) measured 31% of written lines as history under the current prompt.
2. **The flat layout groups nothing.** All pages sit in one dir, and the type only shows in the filename prefix. Chandra
   wants one folder per page type.
3. **Pages go invisible.** The injected index is cut at `INDEX_CAP` (2,048 B) without warning, and `MAX_PAGES` (20)
   is an arbitrary count. new_bsa_react's index is already 2,627 B after 12 pages, so its last pages never reach a session.
4. **Some areas can never validate.** An area dir with `_` (new_bsa_react `parse_service`) yields page names that fail
   `[a-z0-9-]`. This was the one validation failure in the real import.

## Evidence (RED/GREEN micro-test)

The test digested every chunk of 4 real new_bsa_react sessions on `fedora/memory-generate` into empty temp wikis,
3 reps per variant. Every line was read and judged by hand.

| Variant | Lines | History lines | Notes |
|---|---|---|---|
| Current prompt (control) | 39 | 12 (31%) | worktree + branch, merge/push hashes, approved-spec/plan-review narration, bead status |
| Recipe: "a fact line is something still true next month…" | 16 | 4 (25%) | wrote nothing in 8/12 runs; lost most real knowledge |
| **Prohibition: "Don't record session history: no worktree paths, …"** | 30 | 2 (7%) | kept the real rules (amount normalization, ATM fee, formula injection, `\x0b`, aria-pressed won't-fix) |
| Prohibition + `or what happened "in this session"` | 13 | 1 | wrote nothing in 5/9 runs; lost the netting-safety facts |

The plain prohibition ships. Because this failure is a filtering problem, a concrete exclusion list beat the recipe.
The extra clause hurt recall.

## Design

### Layout

One folder per page type, with the area as the filename prefix. There is one `index.md` per wiki, at the root.
There is no `overview.md`.

```
<project>/.pi/wiki/  index.md  gotcha/<area>-<slug>.md  fact/<area>-<slug>.md  decision/<area>-<slug>.md
~/.pi/agent/wiki/    index.md  preference/<slug>.md  environment/<slug>.md  lesson/<slug>.md
```

**Index:**
- **Shape:** every page gets one line, grouped under a `### <type>` heading per non-empty folder, e.g.
  `### gotcha` followed by `- [gotcha/backend-exports](gotcha/backend-exports.md): formula injection, \x0b in cells`.
  This keeps today's one-read lookup.
- **Injection:** the index is injected whole. `INDEX_CAP` is raised from 2,048 B to 6,144 B per wiki (about 1.5K
  tokens) and is enforced, never truncated. Its comment explains why the cap is there: the per-session prompt cost.
- **Over the cap:** the updater gets the cap and the current index size in its prompt. When an update would exceed it,
  it must merge related pages or shorten lines.
- **Page count:** `MAX_PAGES` is removed, so the index budget is the only limit (about 25–35 pages at today's line
  lengths).

- **Valid page paths:**
  - global: `<type>/<slug>.md`, where type is in `GLOBAL_TYPES`
  - project: `<type>/<area>-<slug>.md`, where type is in `PROJECT_TYPES`
  - Slugs are `[a-z0-9-]+`. There is exactly one folder level, and nothing else may sit at the root besides
    `index.md` and `.git` (global only). No `index.md` inside type folders.
- **Area names** are normalized for names: lowercase, with `_` and any other non-`[a-z0-9-]` character mapped to `-`
  (`parse_service` → `parse-service`). The prompt lists the normalized form.
- **Index links** are relative to the wiki root (`gotcha/backend-exports.md`).
- **Validation:**
  - Every page is listed in the index, and every index link resolves.
  - An index over `INDEX_CAP` fails validation, so the run publishes nothing and a later run retries.
- **Caps:** `MAX_PAGES` is removed. The per-page line cap is unchanged.
- **Emptied page:** a page overwritten with empty content is deleted, as today. A type folder left empty is removed.

### Project page types

`PROJECT_TYPES` = `gotcha`, `fact`, `decision`. `overview.md` is dropped.

| Type | Holds | Example |
|---|---|---|
| `gotcha` | Known failures and traps: what breaks, why, and how to avoid it | formula injection in exports; `\x0b` breaks template fill |
| `fact` | True but not in the code: domain rules, deploy and ops order, where things live | BNI overprinted amounts; migration before backend deploy; specs live in `docs/superpowers/specs/` |
| `decision` | Only a choice that no spec or doc records, always with the reason and what was ruled out | aria-pressed not added: no screen-reader users; revisit if that changes |

**Why the types changed:**
- **Spec-less decisions only:** every decision page in the new_bsa_react import restated a spec that already exists
  in `docs/superpowers/specs/` (263 specs there). The prompt says so, and tells the updater to check the repo's specs
  and docs before writing a decision.
- **`fact` is new:** it covers the "project facts that live outside the code" kind, which both Claude Code auto
  memory (`project` and `reference`) and the OpenAB definition of useful memory keep.
- **No overview:** its useful part, where things live and how the parts fit, is a `fact`. Generic repo overviews in
  context files don't measurably help agents (ETH Zurich study, cited by OpenAB).

The global types are unchanged.

### Prompt

- **Naming rule:** reworded for the folder layout.
- **Index rule:** one line per page under its `### <type>` heading, naming concrete topics. Stay under
  `INDEX_CAP` bytes; current size: N. If an update would exceed the cap, merge related pages or shorten lines.
- **Caps line:** drops the page cap.
- **New rule,** placed directly before "Rewrite pages":
  > - Don't record session history: no worktree paths, branch names, commit hashes, test counts, merge/push/deploy status or review/approval narration.

### Code reach

| Where | Change |
|---|---|
| `lib/big-brain.ts` | `PROJECT_TYPES` = gotcha, fact, decision; overview removed. `validPageName` takes a relative path. `validateWiki` walks one level and enforces the index links and the cap. Area normalization. `MAX_PAGES` removed, `INDEX_CAP` raised to 6,144 B. `capIndex` no longer truncates and rewrites `type/x.md` links to absolute paths. The block wording is unchanged. |
| `lib/big-brain-run.ts` | `mdFiles`, `stage`, `preflightAndApply`, the empty-page delete and the git pathspec work on relative paths, one level deep, and create or remove type dirs. Prompt text changes. |
| `lib/big-brain-guard.ts` | `allowedTarget` also allows `<root>/<type>/<file>`: exactly one folder level, still no `..`, dotfiles or symlinks. The type folder name is not checked here; validation rejects wrong names. |
| `extensions/big-brain.ts` | Unchanged. |
| `README.md` | Layout line. |

**Existing flat pages:** no migration code. A flat page fails validation under the new rules, so the wikis are wiped
before use (next section).

## Rebuild (after merge, done by the coordinator)

1. **Back up the old wikis:** `~/.pi/agent/wiki` → `~/.pi/agent/wiki.flat-backup-<date>` (a full copy, including git
   history), and new_bsa_react's `.pi/wiki` → `.pi/wiki.flat-backup-<date>`. Chandra deletes the backups when happy.
2. **Wipe:** empty both wikis. The global one gets a fresh `git init`. Remove the new_bsa_react records from
   `wiki-state/sessions/` and `state.json`. So that their sessions can be re-imported, also reset the state entries for
   the other projects that wrote into the global wiki: trust-me-bro (3 commits) and sme-desk (1).
3. **Rebuild:** run `/big-brain-init` in new_bsa_react. For trust-me-bro and sme-desk, offer `/big-brain-init` to
   Chandra rather than running it unasked, because each run is a background import of up to an hour.

## Testing

- **Unit:**
  - valid and invalid paths in both wikis, including any page at the root (`overview.md` included), two folder levels, a wrong
    type folder and `_` in a slug
  - area normalization
  - index links with folders
  - index validation: unlisted page, dangling link, index over INDEX_CAP rejected (not truncated)
  - no page count cap: 30 pages within the index budget validate
  - injected links rewritten to absolute paths for `type/x.md`
  - an emptied page deleted and its empty dir removed
  - preflight conflict on a nested page
  - git pathspec with a nested path
- **Guard:** allows `<root>/gotcha/x.md`; blocks `<root>/a/b/x.md`, `<root>/../x`, `<root>/.x/y.md` and a
  symlinked folder.
- **Prompt re-test before merge.** The micro-test above used the old page types. Rerun it with the final prompt:
  - Setup: the same 4 sessions, 3 reps, and the current prompt as control.
  - Pass:
    - history lines stay at or below about 10%
    - the real rules from the GREEN run still appear
    - no `decision/` page restates a spec in `docs/superpowers/specs/`
  - On fail: stop and report before merging.
- **Manual:** one real digest of a new_bsa_react session into a temp wiki writes `gotcha/`, `fact/` or `decision/` pages that
  validate.

## Acceptance eval: does the memory help? (before merge)

The pipeline builds a real wiki and an independent reviewer judges whether it helps. If the eval fails, the work stops
and comes back to Chandra before merge, even if the code reviews pass.

1. **Build (time split):** run the new updater over new_bsa_react's human sessions up to and including 2026-11-18.
   The output goes into a temp wiki pair under `.scratch/`; the live wikis stay untouched.
2. **Tasks:** take 6 real tasks from later human sessions (2026-11-19 onward), never seen by the wiki. Each task is
   the session's opening request, plus a fixed suffix: "Plan only: investigate and write the plan, edit nothing."
   The coordinator picks tasks that touch parts of the app the older sessions worked on, and records why each was
   picked.
3. **Arms:** each task runs as a fresh read-only Pi worker (read, grep, find, ls) in new_bsa_react on the same model.
   - **Memory arm:** the session gets the `## Memory wiki` block for the temp wikis.
   - **Control arm:** no block.
   - Each arm runs 2 reps per task, so 24 runs.
4. **Reviewer:** one independent Pi reviewer gets, per task, the two arms' outputs labelled only A and B (order
   randomized), the later session's transcript as ground truth, and the temp wiki. For each pair it reports:
   - which plan is closer to what actually turned out right, or a tie
   - every wiki fact the memory arm used, marked helpful, irrelevant, or wrong/stale
   - any harm: a wrong or stale fact from the wiki that led the plan astray
5. **Pass:**
   - the memory arm wins more pairs than it loses
   - at least half of the used wiki facts are helpful
   - no wrong or stale wiki fact misleads a plan
6. **Report:** a table per task (winner, the facts used and their marks) goes in the final summary with the
   reviewer's verdict.

## Out of scope

- A two-level index (root lists folders only). Rejected: agents are unlikely to take the extra read, so pages behind it
  go unread.
- Per-prompt relevance filtering of the index.
- Automatic migration of flat pages (Chandra chose wipe and rebuild).
- Area folders or deeper nesting.
- The `child exited 1` flake (about 8% of child runs in every variant; model/9Router side).

## Status History

- 2026-11-22 12:22 WIB: Waiting approval
- 2026-11-22 12:22 WIB: Revised: unlimited pages, two-level index (root lists folders only)
- 2026-11-22 12:22 WIB: Waiting approval
- 2026-11-22 12:25 WIB: Revised: single grouped index, INDEX_CAP 6 KB enforced, no two-level index
- 2026-11-22 12:25 WIB: Waiting approval
- 2026-11-22 12:32 WIB: Revised: drop decision page type (specs already hold decisions)
- 2026-11-22 12:32 WIB: Waiting approval
- 2026-11-22 12:34 WIB: Revised: project types gotcha/fact/decision (spec-less only), no overview
- 2026-11-22 12:34 WIB: Waiting approval
- 2026-11-22 12:37 WIB: Revised: acceptance eval — build wiki from older sessions, reviewer judges blind A/B on later real tasks
- 2026-11-22 12:37 WIB: Waiting approval
- 2026-11-22 12:38 WIB: Approved
