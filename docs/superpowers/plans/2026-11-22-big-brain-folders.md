# big-brain folders Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:**
- Type-folder wikis, one grouped index per wiki (enforced 6 KB cap, no page cap), and the no-history prompt rule.
- Project types are gotcha, fact and decision.
- Then prove with a blind A/B eval that the memory helps.

**Spec:** [2026-11-22-big-brain-folders-design.md](../specs/2026-11-22-big-brain-folders-design.md) (Approved). The spec wins on conflict.

**Tech stack:** Node v26 (`.ts` runs directly), `node:test`. Test command: `node --test tests/*.test.ts` (72 pass on `main` today).

## Conventions

- Use the existing big-brain style. Tests use temp dirs and a temp HOME, never the real `~/.pi` or a real wiki.
- **Page path:** a relative path `"<type>/<slug>.md"` with exactly one `/`. Everywhere below, "page" means such a path.

## File ownership

| File | Task |
|---|---|
| `lib/big-brain.ts`, `tests/big-brain.test.ts` | 1 |
| `lib/big-brain-run.ts`, `tests/big-brain-run.test.ts` | 2 (after 1: run tests call the real `validateWiki`) |
| `lib/big-brain-guard.ts`, `tests/big-brain-guard.test.ts` | 3 |
| `README.md` | 4 |
| `.scratch/bbtest/` (untracked) | 5 (after 2 and 3) |
| `.scratch/eval/` (untracked) | 6 (after 2 and 3) |

- **Parallel heads:** 1, 3 and 4.
- **Chain:** 2 waits for 1, because the files are disjoint but `runChunk` calls the real `validateWiki`.
- **Evals:** 5 and 6 wait for both 2 and 3, because their children write nested pages through the new guard. Once
  both are done, 5 and 6 run in parallel.

## Blast Radius

| Changed | Dependents found (file:line) | Handling |
|---|---|---|
| `PROJECT_TYPES` (`lib/big-brain.ts:13`) | `validPageName` `:147`; prompt text `lib/big-brain-run.ts:104` | Task 1 changes the value. Task 2 rewrites the prompt. |
| `GLOBAL_TYPES` (unchanged value) | `:145`; prompt `run.ts:111` | Task 2 rewords the prompt for folders. |
| `MAX_PAGES` (`lib/big-brain.ts:10`) | `validateWiki` `:166`; `run.ts:11` import and `:118` caps line; test `big-brain.test.ts:166-168` (21 pages fail) | Task 1 removes it and replaces the test with "30 pages within the index cap validate". Task 2 removes the import and the prompt line. |
| `INDEX_CAP` (`:9`) | `capIndex` `:184-185`; test `big-brain.test.ts:8,187` (truncation test) | Task 1 sets it to 6144 and makes `capIndex` stop truncating. It rewrites the truncation test into "an over-cap index fails `validateWiki`", and `injectBlock` injects the index whole. Task 2 passes the cap and the current size into the prompt. |
| `validPageName` (`:144`) | `validateWiki` `:163`; tests `big-brain.test.ts:131-141` | Task 1 changes it to take a page path and rewrites the tests. No other caller (grep). |
| `validateWiki` (`:151`) | `run.ts:23` import, `:162` call; tests `big-brain.test.ts:144-170` | Task 1 changes the walk to one level plus index rules and rewrites the tests. Task 2 changes nothing at the call site. |
| `areas` (`:132`) | `run.ts:13,144,149` (prompt + validation), test `big-brain.test.ts:123-128` | Task 1 makes `areas()` return normalized names (`_` → `-`), so both callers get them for free. A test case is added. |
| `capIndex` / `injectBlock` (`:182,191`) | `extensions/big-brain.ts:135`; tests `big-brain.test.ts:173-188` | Task 1 changes the link rewrite regex to `type/x.md` and drops the truncation. The extension is unaffected (it passes raw index text), but `tests/big-brain-ext.test.ts:15,67` uses a flat `lesson-x.md` index. That still injects, because `capIndex` doesn't validate, and the assertion only matches `lesson-x\.md`. Leave it. |
| `mdFiles`, `stage`, `preflightAndApply`, empty-page delete, git add/commit (`run.ts:46-95,157-172`) | `runChunk` only; `preflightAndApply` exported and used by tests `big-brain-run.test.ts` | Task 2: page paths, mkdir of the type dir on write, rmdir of an empty type dir after a delete, staging copies subdirs. Every fixture in `big-brain-run.test.ts` that uses `overview.md` or flat `lesson-a.md` (lines 72-176) moves to the new layout. |
| `buildPrompt` (`run.ts:97`) | `runChunk` only; `.scratch/bbtest/run-copy.ts` (a scratch copy) | Task 2. Task 5 regenerates `run-copy.ts` from the new file. |
| `realDeps` (`run.ts:265`, not exported) | the `import.meta.main` block | Task 2 exports it (`export const realDeps`), so the Task 6 eval driver can call `main(argv, { ...realDeps, home: tmp })`. No other effect. |
| `allowedTarget` (`guard.ts:19`) | guard handler `:52`; tests `big-brain-guard.test.ts:20-37` (line 26 asserts `root/sub/x.md` is rejected) | Task 3 allows exactly one subdir level and flips that assertion to allowed. Two-level paths stay rejected. |
| `extensions/big-brain.ts` | `/big-brain-init` `mkdirSync(projectWiki)`; injection reads `index.md` | Unaffected: no page paths there (grep `\.md` shows only `index.md`). |
| `README.md:112-131` | docs | Task 4. |

## Task 1: names, validation, index (`lib/big-brain.ts`)

1. **Types:**
   - `PROJECT_TYPES = ["gotcha", "fact", "decision"]`. Delete the `overview.md` comment and special case.
   - Delete `MAX_PAGES`.
   - `INDEX_CAP = 6144`, with a comment: `// injected into every session: the per-session prompt cost`.
2. **`areas(root)`:** returns names normalized with `.toLowerCase().replace(/[^a-z0-9-]/g, "-")`, deduped, plus `db` and `cross`.
3. **`validPageName(path, kind, areas)`:** `path` must be `<type>/<slug>.md` with exactly one `/`.
   - **Global:** type in `GLOBAL_TYPES`, slug `^[a-z0-9-]+$`.
   - **Project:** type in `PROJECT_TYPES`, slug `<area>-<rest>` with `rest` matching `^[a-z0-9-]+$` (same area rule as today).
4. **`validateWiki(dir, kind, areas)`:**
   - **Root entries:**
     - `index.md` (file) is allowed.
     - `.git` (dir) is allowed in global only.
     - Directories are walked.
     - Anything else is an error: a root file, a dotfile or a symlink.
   - **Inside a dir,** every entry must be a regular file whose `dir/name` passes `validPageName`. No subdirs, and no `index.md` inside.
   - **Every page:**
     - secret scan and line cap, as today
     - listed in `index.md`: some link equals its path
   - **Every index link** `](x.md)` must resolve to an existing page.
   - **Index size:** `index.md` over `INDEX_CAP` bytes → error `index too big: N > 6144`.
   - **Secret scan** on the index, as today.
   - **No page-count check.**
   - **Empty type dirs** are allowed: the runner removes them, so validation must not trip on one.
5. **`capIndex`:** no truncation. Rewrite `](<type>/<slug>.md)` links to `](${dir}/<type>/<slug>.md)` using the regex `/\]\(([a-z]+\/[^)/]+\.md)\)/g`. `injectBlock` keeps its wording.

- [ ] **Step 1: failing tests** in `tests/big-brain.test.ts`. Rewrite the `validPageName`, `validateWiki`, `injectBlock` and `areas` tests:
  - **Valid names:** global `lesson/x.md`, `preference/commit-msgs.md`; project `gotcha/frontend-x.md`, `fact/db-y.md`, `decision/cross-z.md`, `gotcha/parse-service-x.md` with area `parse-service`.
  - **Invalid names:** `lesson-x.md` (flat), `overview.md`, `gotcha/x.md` (no area), `lesson/a/b.md`, `notes/x.md`, `gotcha/frontend-X.md`, `fact/parse_service-x.md`, global `gotcha/x.md`.
  - **validateWiki:**
    - an ok grouped index validates
    - `.git` is allowed in global only
    - an unlisted page fails
    - a dangling link fails
    - an index over the cap fails and isn't truncated
    - 30 pages within the cap validate
    - a nested subdir fails
    - `index.md` inside a type dir fails
    - a root `overview.md` fails
    - an empty type dir is ok
    - a secret fails
    - a page that's too long fails
  - **injectBlock:** links become absolute (`/r/.pi/wiki/gotcha/frontend-x.md`), and an over-cap index is injected whole (no truncation in `capIndex`).
  - **areas:** `parse_service` → `parse-service`.
- [ ] **Step 2:** run the tests and see them fail. **Step 3:** implement. **Step 4:** `node --test tests/big-brain.test.ts` is green. The run tests may go red until Task 2; note it in the commit.
- [ ] **Step 5:** commit `feat(big-brain): type folders, enforced index cap, gotcha/fact/decision`.

## Task 2: runner and prompt (`lib/big-brain-run.ts`)

1. **`mdFiles(dir)`:** returns page paths (`type/x.md`) one level deep, plus `index.md` at the root. It skips `.git` and dot-entries.
2. **`stage(live, staged)`:** copies every path from `mdFiles`, creating its type dir.
3. **`preflightAndApply`:**
   - Writes create `dirname` with `mkdir -p` before the tmp+rename. The tmp file sits in the same dir as the target, so the rename stays on one filesystem.
   - After deletes, `rmdir` each type dir that is now empty. Ignore ENOTEMPTY and ENOENT.
   - The returned names are page paths, so the git pathspec just works.
4. **Empty-page delete:** iterates over `mdFiles`. After unlinking, empty dirs in staging are removed.
5. **Git:** unchanged (`git add -A -- <paths>`). Paths are relative to the wiki root, which is the cwd.
6. **`buildPrompt`:**
   - **Project section:** what the project wiki holds, and a table of the 3 types with their one-line "holds" from the spec.
   - **Decision guard:** "Write a decision only when no spec or doc records it: first check the repo's docs/ (e.g. `docs/superpowers/specs/`) and README; if one covers it, write nothing, or at most a fact line pointing to it."
   - **Areas:** the normalized list.
   - **Global section:** reworded for folders.
   - **Rules:**
     - Insert the no-history rule verbatim from the spec, directly before "Rewrite pages".
     - Naming: `<type>/<slug>.md`, project `<type>/<area>-<slug>.md`, one folder level.
     - Index: one line per page under `### <type>`, with a link path relative to the wiki root, naming concrete topics. Each index under `INDEX_CAP` bytes, with "current size: N bytes" per wiki. If an update would exceed the cap, merge related pages or shorten lines.
     - Caps: drop the page cap.
   - **Deletion:** "To delete a page, overwrite it with empty content" stays.
   - **Validation-error feedback** is out of scope.
- [ ] **Step 1: failing tests** in `tests/big-brain-run.test.ts`. Move every fixture to the new layout (`G = { "index.md": "### lesson\n- [lesson/a](lesson/a.md): a\n", "lesson/a.md": … }`, project `gotcha/db-x.md`), then add:
  - a nested page is published, and its type dir is created in live
  - an emptied page is deleted live, and its now-empty type dir is removed
  - a hash conflict on a nested page publishes nothing in either wiki
  - the git commit pathspec includes `lesson/a.md`
  - the prompt contains the no-history rule verbatim, `decision`, `fact`, `gotcha`, `INDEX_CAP` and the current index size, and does not contain `overview.md` or `MAX_PAGES`/"pages per wiki"
  - `writePages` in tests must create the dirs
- [ ] **Step 2:** run the tests and see them fail. **Step 3:** implement. **Step 4:** `node --test tests/*.test.ts` is all green.
Also `export const realDeps` (used by the Task 6 driver).

- [ ] **Step 5:** commit `feat(big-brain): runner handles type folders; no-history prompt rule`.

## Task 3: guard (`lib/big-brain-guard.ts`)

`allowedTarget`:
- **Allowed:** `realParent(abs)` equals a root (today's behaviour), or its parent equals a root, which means exactly one subdir level.
- **Still rejected:**
  - `..`
  - any dot-named segment, e.g. `.x` (checked on the subdir name too)
  - a symlinked target file
  - a symlinked subdir (`lstat` the subdir when it exists)
  - two levels or more
- **New subdir:** it may not exist yet (the write tool creates it). `realParent` already handles a missing parent.

- [ ] **Step 1: failing tests.**
  - **Allowed:** `root/gotcha/x.md` (new subdir) and `root/lesson/x.md` (existing subdir).
  - **Rejected:**
    - `root/a/b/x.md`
    - `root/.x/y.md`
    - `root/linkdir/x.md`, where `linkdir` is a symlink to a dir inside the root and to one outside
    - existing `..` and outside cases
  - **Flip:** today's rejected assertions for `root/sub/x.md` and `root/nope/x.md` (`tests/big-brain-guard.test.ts:26-27`) are one level deep, so both become allowed. Replace them with two-level rejected cases.
- [ ] **Step 2–4:** red, implement, green (`node --test tests/*.test.ts`).
- [ ] **Step 5:** commit `feat(big-brain): guard allows one type-folder level`.

## Task 4: README

In the big-brain section (`README.md:112-131`):
- the layout, with type folders and one grouped index
- project types gotcha/fact/decision, where decision means only choices no spec records
- the index is capped at 6 KB per wiki and enforced, with no page cap
- the no-history rule in one line

Commit `docs(big-brain): folder layout`.

## Task 5: prompt re-test (spec "Prompt re-test before merge")

All work stays in `.scratch/bbtest/` (untracked, never committed).

1. **Prepare the harness:**
   - Regenerate `run-copy.ts` from the new `lib/big-brain-run.ts` with the same `sed` as before: import paths `../../lib/…`, `export function buildPrompt`, cut from `if (import.meta.main)` to the end.
   - Adapt `micro.ts`:
     - `idx()` reads the new index.
     - The prompt replace for `extra` is dropped: the rule is built in now, and "control" means the old prompt from `git show main:lib/big-brain-run.ts`.
     - Keep 4 parallel workers, 5-min timeouts and `--tools read,write,edit`.
     - **Guard path:** `micro.ts` hardcodes `/home/chandraliuswanto/trust-me-bro/lib/big-brain-guard.ts`, the old flat-only guard. Replace it with this worktree's `lib/big-brain-guard.ts` via `new URL("../../lib/big-brain-guard.ts", import.meta.url)`.
     - **Control arm:** must use the old guard from `main`, because the old prompt writes flat pages. Copy `git show main:lib/big-brain-guard.ts` into `.scratch/bbtest/guard-main.ts` and use that for control.
     - **Check before running:** grep that no `/home/chandraliuswanto/trust-me-bro/` path remains.
2. **Run:** the same 4 sessions × 3 reps for new and control (control output already exists in `out/control/`; rerun it only if the harness changed what control means).
3. **Score:** read every written line and mark it history or durable.
4. **Pass:**
   - history ≤ about 10% of lines
   - the real rules from the earlier GREEN run reappear: amount normalization or BNI overprint, ATM fee, formula injection, `\x0b`, aria-pressed won't-fix
   - no `decision/` page restates a spec in `/data/projects/new_bsa_react/docs/superpowers/specs/`: grep the spec titles for each decision page
   - every output wiki passes the new `validateWiki`
5. **Report:** write the table (lines, history count, rules present, decisions vs specs, validate result) to `.scratch/bbtest/RETEST.md`, and put the summary in `worker_done`.
6. **On fail:** do not tune the prompt yourself. Report the failing numbers and stop.

## Task 6: acceptance eval harness (spec "Acceptance eval")

All work stays in `.scratch/eval/` (untracked). Only the coordinator launches the reviewer; this task produces its inputs.

1. **Build the wiki (time split):** for each human session in `~/.pi/agent/sessions/--data-projects-new_bsa_react--/` with a basename before `2026-11-19`, at least 2 user messages and not a worker (use `initCandidates`' rules), run the new runner's digest into a temp wiki pair. Use the real `main()` with `Deps` pointed at a temp HOME whose `.pi/agent/settings.json` copies `bigBrain.model`, and a temp project root.
   - **Project root:** a `git worktree add --detach /var/tmp/pi-scratch/bsa-eval-src <commit>` of new_bsa_react at commit `6749a8d8`, the last main commit before 2026-11-19 01:27 local. Its `.pi/wiki` is the project wiki.
   - **Registrations:** write records with `pid: 0`, then run `--mode catchup --project <root>`.
   - **Driver:** do not run the CLI with a fake HOME. pi children need the real `~/.pi/agent` (`models.json` defines the custom `fedora` provider, and auth lives there too), and those must never be copied.
     - Write `.scratch/eval/build.ts`: `import { main, realDeps } from "../../lib/big-brain-run.ts"` and call `await main(["--mode", "catchup", "--project", root], { ...realDeps, home: tmp })`.
     - Only the wiki, state and registration paths use `tmp`. `runChild` spawns pi with the real environment and the worktree's guard.
     - Registration records go in `stateDir(tmp)/sessions/`.
     - Catch-up digests them oldest first. The global wiki goes to `<tmp>/.pi/agent/wiki`, which `main` creates and git-inits.
     - Never point any write at the real `~/.pi/agent/wiki*`. Before running, assert that `tmp` is under `/var/tmp/pi-scratch/`.
   - **Check:** confirm both wikis validate. Record the page list.
2. **Tasks:** 6 opening requests from human new_bsa_react sessions on or after 2026-11-19 (main dir and its worktrees). Candidates:
   - `2026-11-19T01-27`: Verify-page clickability. Use the 2nd message, "is there systematic to check wheter the button is non-clickable…", plus the context of the first.
   - `2026-11-19T07-12`: month-average mock.
   - `2026-11-19T11-07`: full-repo ponytail review, scoped to "netting".

   Pick 3 more from worktree sessions or from later main-dir sessions whose opening request is a concrete product task. For each, write `tasks/<n>.md` with the request text, the suffix "Plan only: investigate and write the plan, edit nothing.", the source session, and why it was picked: which wiki area it touches. If fewer than 6 usable tasks exist, use what exists (at least 4) and say so.
3. **Arms:** per task × 2 reps × {memory, control}, run in the eval checkout above (code as it was before the tasks):

   ```
   pi -p --no-session --no-extensions --tools read,grep,find,ls --model fedora/opus
   ```

   Run with the real HOME (provider config), from the eval checkout as cwd. `--no-extensions` keeps the live
   big-brain extension from injecting the real wikis into either arm.

   - **Memory arm:** `--append-system-prompt <block file>`, where the block comes from the real `injectBlock(globalIdx, projectIdx, gDir, pDir)` over the temp wikis.
   - **Control arm:** no block.
   - Save stdout to `arms/<task>-<arm>-r<k>.md`, with a 10-min timeout each.
   - These are eval subjects, not delegated workers. The updater uses `pi -p` the same way.
4. **Blind packets:** per task and rep pair, write `packets/<task>-r<k>.md` containing:
   - the task text
   - plan A and plan B, with a randomized arm order recorded only in `key.json`
   - the ground-truth path: the later session file, plus a condensed excerpt of what was actually done or found (use `condense()` and cap it at 30 KB)
   - the temp wiki paths
5. **Report:** list the packets and key file in `worker_done`. Do not judge the plans yourself.

## Coordinator steps (not beads)

1. **Eval reviewer:** after Task 6, launch one independent reviewer (astra medium) over `packets/` with the spec's rubric:
   - the winner per pair, or a tie
   - each used wiki fact, marked helpful, irrelevant or wrong/stale
   - harm
2. **Unblind and score:** unblind with `key.json` and compute the pass criteria. Put the per-task table in the final summary.
3. **On fail:** stop and report to Chandra before integration.
4. **Final code review:** as usual (`final-review.md`).
