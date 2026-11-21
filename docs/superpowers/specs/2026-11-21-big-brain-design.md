# big-brain: Pi wiki memory

**Status:** Approved (since 2026-11-21 21:29 WIB)

`big-brain` is only the name of the extension (code, setting `bigBrain.model`, env `PI_BIG_BRAIN`, commit prefix).
On disk it is a plain wiki: `~/.pi/agent/wiki/` and `<repo>/.pi/wiki/`.

## Problem

Pi agents start every session knowing nothing from earlier ones. Chandra re-states the same preferences and
corrections, and lessons learned in one project are lost to the next. What exists today:

- `~/.pi/agent/APPEND_SYSTEM.md`: hand-written standing rules (1.5 KB).
- `bd remember` / `bd memories`: atomic per-project facts in some repos (e.g. sme-desk).
- Raw session JSONL under `~/.pi/agent/sessions` (539 dirs; ~358 are automated repair workers; 852 files touched in
  the last 7 days). This is too noisy to inject or search directly: one agent read ~60 MB and kept nine sentences.

## Goal

A small set of linked markdown pages, in the style of Karpathy's "LLM Wiki", maintained by a background updater on a
cheap model, never by the main agent. The main agent sees a short index at session start and reads pages on demand.

## Two wikis

| | Global | Project |
|---|---|---|
| Path | `~/.pi/agent/wiki/` | `<main checkout>/.pi/wiki/` |
| Shared | Private | With teammates, through git |
| Holds | Chandra's preferences and corrections; machine/environment facts; lessons that apply across projects | What the project is, how its parts fit, decisions and why, gotchas spanning several facts |
| Versioning | Own git repo, auto-commit after each update | Never committed by the updater; Chandra reviews the diff like any change |

Each wiki has an `index.md` with one line per page (`- [page](page.md): concrete topics`) plus up to 20 pages.

**Page types.** Each wiki has three fixed types, adapted from Karpathy's entity, concept and synthesis pages. The type
is a filename prefix (`<type>-<slug>.md`), so it shows in every index line and needs no parsing:

| Wiki | Type | Holds | Example |
|---|---|---|---|
| Global | `preference` | How Chandra wants things done | `preference-commit-messages.md` |
| Global | `environment` | This machine and its tools (fedora, 9Router, Orca, paseo) | `environment-9router.md` |
| Global | `lesson` | Techniques and gotchas that apply across projects | `lesson-9router-combos.md` |
| Project | `overview` | What the project is and how its parts fit (at most one page) | `overview.md` |
| Project | `decision` | A choice made and why, so later sessions don't undo it | `decision-db-alembic-baseline.md` |
| Project | `gotcha` | Traps that span several facts (single facts stay in bd) | `gotcha-cross-api-contract.md` |

**Areas (project wiki).** `decision` and `gotcha` pages are named `<type>-<area>-<topic>.md`. The area is one of:
- a top-level app dir of the repo (`frontend`, `backend`, `emb_api`, `parse_service`)
- `db` for schema and migrations, which live inside `backend/alembic` in rm-ally and sme-desk rather than in a dir of
  their own
- `cross` for pages that span apps

Pages stay flat, with no `ui/` or `backend/` folders. At 20 pages, folders would hold 2–4 pages each, area names
differ per repo, and nesting would complicate the guard. This matches the hand-written wikis already in these repos,
which group by kind and put the area in the filename (rm-ally `wiki/audits/2026-09-30-frontend.md`). Sorting the
index groups pages by type, then by area.

Not adopted from the LLM Wiki: per-source summary pages (sessions aren't worth a page each; citations cover them) and
`log.md` (git history plus citations do that job).

The project wiki is opt-in per repo (see "Main checkout"); otherwise only the global wiki applies.

**Worktrees.** The project wiki always lives in the repo's main checkout (see "Main checkout" below), even when the session runs in a linked worktree. That gives
one wiki per repo: parallel worktrees don't conflict on it, and it survives worktree removal. Nothing here is specific
to any one workflow.

**bd coexists.** bd memories stay the store for atomic project facts. Before editing a project wiki, the updater
reads `bd memories` (if `bd` exists in the repo) and links to or mentions those facts instead of copying them. It never
calls `bd remember`.

## Updater

Code: `extensions/big-brain.ts` (hooks + prompt block), `lib/big-brain.ts` (deterministic helpers),
`lib/big-brain-run.ts` (supervisor, run with `node`, which strips TS types on v26), `extensions/big-brain-guard.ts` (loaded only
into the updater child).

### Operational files (outside both wikis, never in any git history)

`~/.pi/agent/wiki-state/`:
- `sessions/<sha1(sessionFile)>.json`: `{ sessionFile, projectRoot, pid }`. Only the extension writes these, with
  no lock (temp file plus rename), so registering never waits on a running digest.
- `state.json`: `{ [sessionFile]: { marker, failures, status } }`. `marker` is the last digested entry id, and
  `status` is one of `active | done | skipped`. Only the supervisor writes it, under the lock, followed by an atomic
  rename.
- `lock` (supervisor pid; broken when that pid is dead), `log` (one line per failure), `runs/<id>/` (staging, removed
  after each run).

The wiki dirs hold only `index.md` and pages, plus the global wiki's own `.git`.

### Triggers

1. First `before_agent_start`: if the session is digestible (see Skip rules), write its `sessions/` record, then start
   the supervisor in catch-up mode. An unregistered session
   never triggers anything.
2. `session_compact`: start the supervisor for this session.
3. `session_shutdown`: start the supervisor for this session with `final: true`.

The extension starts the supervisor with `spawn(process.execPath, [lib/big-brain-run.ts, args], { detached: true,
stdio: "ignore" }).unref()` and returns at once. Pi calls `process.exit(0)` right after the shutdown handlers
(`dist/modes/interactive/interactive-mode.js`), so everything after the spawn belongs to the supervisor, never the
parent.

### Supervisor run (`lib/big-brain-run.ts`, one transaction)

1. Take the lock, or exit quietly (the markers don't move, so the next trigger retries). Create
   `~/.pi/agent/wiki/` with `git init` if it is missing.
2. Pick the work. For a named session, use it if it has a `sessions/` record. For catch-up, use the records with the
   same `projectRoot` whose pid is dead, whose `status` is not `done` or `skipped`, and whose file has entries after
   `marker`. Files without a record are ignored, so workers and repair runs are never billed.
3. For each session, fix `end` = the last entry id in the file now. If `marker..end` holds fewer than 2 user messages,
   skip it. On `final: true`, advance `marker` to `end` instead. Otherwise condense the whole slice (see Input) into
   chunks of up to 60 KB, oldest first. This check covers the whole slice, so chunk boundaries never drop turns.
4. Per chunk:
   - Copy `index.md` and the pages of both wikis into `runs/<id>/global/` and `runs/<id>/project/`, and record each
     file's hash.
   - Run the child against the staging copy, with a 5 min timeout:
     `PI_BIG_BRAIN=off BIG_BRAIN_ROOTS=<staging dirs> pi -p --no-session --no-extensions -e <pkg>/extensions/big-brain-guard.ts
     --model <model> --tools read,write,edit "<prompt>"`.
   - **Validate** the staging copy. Only `index.md` and typed pages are allowed at the top level: global
     `^(preference|environment|lesson)-[a-z0-9-]+\.md$`, project `overview.md` or `<decision|gotcha>-<area>-<topic>.md`, checked as a prefix match against
     the allowed areas (lowercase top-level dirs of `projectRoot`, plus `db` and `cross`) so hyphenated dirs like
     `internal-gitlab-api` work, with
     nothing nested or hidden. Caps are 20 pages and ~40 lines per page. The secret scan finds no hits. Every index
     link points to an existing page.
   - **Publish** only on child exit 0 and passing validation:
     - **Preflight** every change before writing anything, deletions included. Each live file must still have its
       recorded hash, or already equal the staged content (a retry after a partial publish). If any page fails, a
       concurrent hand edit happened, so publish nothing.
     - **Apply**: write each changed page to a temp file and rename it into the live wiki, then delete the pages the
       child removed.
     - **Global wiki**: run `git add -A -- index.md '*.md'`. Commit (`big brain: <citation>`) only if
       `git diff --cached --quiet` reports changes, so "nothing written" and project-only updates count as success.
     - Advance `marker` to the chunk's end.
   - On any failure:
     - Before publish: discard the staging copy (the live wikis are untouched).
     - During apply or git: stop where it failed. Every page is still whole, and the next run redoes the chunk, which
       preflight accepts because the live content already matches.
     - Either way, add 1 to `failures`, write one `log` line, and stop. After 3 failures the session becomes `skipped`.
5. On `final: true` with nothing left, set `status: done`.
6. Remove `runs/<id>/` and release the lock.

shortcut: if apply fails or the supervisor dies mid-publish, a chunk can be half-published until the next run redoes
it. Each page stays whole, since every write is a rename. Upgrade to a publish journal if this is ever seen.

### Write guard

- The child has no `bash`. The supervisor runs `bd memories` itself (if `bd` is on PATH and the repo has `.beads/`)
  and pastes the output into the prompt.
- `big-brain-guard.ts` blocks every `write`/`edit` `tool_call` whose target is not directly inside one of the two staging
  dirs in `BIG_BRAIN_ROOTS`. To check a target, it resolves the real path of the nearest existing parent, appends the
  remaining name, and does a separator-aware prefix check, so `/x/wiki-evil` doesn't count as inside `/x/wiki`. It
  rejects `..`, hidden names and nested paths. It also rejects any target that is itself a symlink, checked with
  `lstat` on the target, not only its parent.
- The child never sees a live wiki, its `.git` or the state files, so it can't break locking, history or hooks.
  Validation is the second gate before anything goes live.

### Skip rules (a session is digestible only if none apply)

Based on a sample of real sessions (2026-11-21): the newest 40 in `orca-workspaces` were all Orca workers, 30 of the
newest 40 paseo worktree sessions were paseo-driven agents, and in news_api (the busiest dir) 23 of 40 were Orca
workers and 10 of 40 were scheduled OCBC edition jobs.

- `PI_BIG_BRAIN=off`. Set by the updater child, by scheduled jobs (e.g. the OCBC daily/weekly edition launcher; adding the
  one line there is part of the build) and by any other automation.
- `ctx.hasUI` is false (print and json mode, which covers the paseo repair workers).
- `ORCA_TERMINAL_HANDLE` starts with `structworker_` (Orca orchestration worker; the coordinator has none).
- The first user message starts with `You are working inside Orca, a multi-agent IDE. You are a dispatched worker`
  (184 of 184 preamble sessions sampled) or with `<paseo-system`. This also catches workers that the env check misses.
  Since it can only be seen once the first message exists, the session registers on its first `before_agent_start`,
  not at `session_start`.
- RPC sessions report `hasUI: true`, which is intended, because Orca's chat view is a session you talk to.
- Small slices: handled per whole pending slice (Supervisor run step 3), never per chunk.

### Input

`lib/big-brain.ts` condenses the JSONL entries after `marker` up to `end`: user messages and assistant text in full, tool
calls as the name plus the first ~200 chars of arguments, tool results dropped. Chunks are split at entry boundaries,
up to 60 KB each, oldest first. A single condensed entry over 60 KB (a pasted log, for example) is cut to its first
60 KB with a `[truncated]` mark, the only lossy case. The child gets: one chunk, the session citation id,
both staging indexes, `bd memories` output, the staging paths, and the rules below.

### Updater rules (in the prompt)

- The default is to write nothing. Keep only what a future session would want, and that isn't already in
  APPEND_SYSTEM.md, AGENTS.md, CLAUDE.md, bd, or the repo's own docs (`README.md`, `docs/`, a hand-written `wiki/`
  as in rm-ally and rm-ally-knowledge). The child may read those (`read` isn't guarded) but never writes there; it
  links to them instead of copying.
- Rewrite pages; don't just append. Merge duplicates. When a newer session contradicts a fact, replace it and keep the
  newer citation.
- Every fact line ends with a citation: `[s:2026-11-21 a1b2c3]` (session date + first 6 chars of the session id).
- Caps: about 40 lines per page, 20 pages per wiki, index entries one line each.
- Never write secrets: keys, tokens, passwords, auth URLs, private user data.
- Name every page `<type>-<slug>.md` using that wiki's three types (see "Page types"). Project `decision`/`gotcha`
  slugs start with the area (see "Areas"); the prompt lists the repo's top-level dirs. Put a fact on the page of the
  type it belongs to.
- Keep `index.md` in sync with the pages. Each line is `- [name](name.md): <the concrete topics on the page>`, with
  relative links so the shared project wiki has no machine paths, e.g. `commit messages, reply length, review
  habits`, not `preferences`.

### Main checkout

`projectRoot` = the first `worktree` line of `git worktree list --porcelain`, which is the main checkout in every
layout, including `--separate-git-dir`. There is a project wiki only if `<projectRoot>/.pi/wiki/` already exists. It's opt-in: run `mkdir .pi/wiki` in repos
you care about. Without it (or outside a git repo), digestible sessions still feed the global wiki, and the updater
never creates `.pi/wiki/` itself.

## Reading (main agent)

The extension reads both indexes once at `session_start` and appends this block to the system prompt in `before_agent_start` (same text every
turn, so prompt caching survives). No new tool. Each index is capped at 2 KB. The relative links in the files are
rewritten to absolute paths in the injected copy only, so the read tool can open them from any cwd:

```
## Memory wiki
Notes kept from your past sessions with this user. Each index line is a page path and what it covers.
Before you start a task, check the summaries below. Read every page whose summary covers the task (how the user
wants something done, this machine, this project) with the read tool, then follow it. If the user's current message
contradicts a page, the message wins.
### Global wiki (~/.pi/agent/wiki/)
<global index.md>
### Project wiki (<main checkout>/.pi/wiki/)
<project index.md>
```

An index is left out when it's missing or empty; the whole block is left out when both are.

**Who gets the block.** Every session except `PI_BIG_BRAIN=off` (the updater child and anything that opts out). This
includes Orca workers, paseo agents and headless runs, so a git-gud worker also follows the user's conventions and
known gotchas. The skip rules decide only who gets *digested*. Reading costs about 4 KB of cached prompt and no model
calls. Injection is implemented the same way as `extensions/agent-forum.ts` (`before_agent_start`).

**Wording test (2026-11-21, fedora/sonnet, full user prompt, 5 runs each).** Task: "review lib/forum.ts change,
give me the git commit command". The global index had a vague `user.md: how Chandra likes things done`, the page
held the commit-message convention, and the project index pointed to a testing gotchas page.

| Variant | Read user.md | Followed convention | Read project page |
|---|---|---|---|
| Control: index + "Read a page with the read tool when it is relevant." | 1/5 | 4/5 (one `Lower forum MAX ...`) | 3/5 |
| Block above | 5/5 | 5/5 | 5/5 |

An unrelated task ("what is 2^10") read 0 pages in 3/3 runs with the block above. When the index summary was
specific ("commit messages, replies...") the control already read the page 5/5, so the block matters most for vague
summaries. So the updater prompt also requires each index line to name the concrete topics on its page.

## Settings

The model is the only setting, in `~/.pi/agent/settings.json` (`bigBrain.model`), with default
`fedora/memory-generate`. That's a 9Router combo with strategy `fallback`: luna first, then haiku (`cc/claude-haiku-5-5`) if luna errors, so fallback
across models lives in 9Router and not in the extension. A failure after the combo is exhausted counts as a
failed chunk (step 4 of "Supervisor run").

## Testing

- Page types: a typed name passes validation; an untyped name (`notes.md`), a wrong-wiki type (`gotcha-x.md` in the
  global wiki) and `overview-x.md` (overview is the single fixed name `overview.md`) fail it. `gotcha-frontend-x.md`,
  `gotcha-db-x.md` and `gotcha-cross-x.md` pass in a repo with `frontend/`; `gotcha-ui-x.md` fails there (no `ui/`
  dir). `decision-internal-gitlab-api-auth.md` passes in rm-ally-knowledge.
- Guard: a new page inside a staging dir is allowed. Blocked: outside it, `..`, a sibling prefix (`wiki-evil`), a
  nested or hidden path, and a symlink pointing out.
- Validation/publish: a failed child or failed scan leaves the live wikis byte-identical; a page hand-edited during
  the run is not overwritten; global commit stages only `.md` pages.
- Markers: the marker advances only to the fixed `end`. An oversize slice is digested in order, chunk by chunk. A
  2-user-message slice split across chunks is still digested. A 1-message slice waits, or is skipped on `final`.
  Catch-up skips live pids, unregistered sessions, and `done`/`skipped` ones.
- Registration: a `sessions/` record is written while the lock is held by another run.
- Publish: a preflight hash conflict changes nothing; a retry after a partial apply succeeds; "write nothing" and
  project-only runs exit 0 with no empty global commit; a brand-new empty global wiki is initialized.
- Skip rules: `ORCA_TERMINAL_HANDLE=structworker_x`, a dispatched-worker preamble and a `<paseo-system` first message
  are skipped; a plain user first message with no handle is digested.
- Opt-in: a repo without `.pi/wiki/` gets no project pages and the dir is not created; the global wiki still updates.
- Worktree: a session in a linked worktree resolves to the main checkout's `.pi/wiki/`.
- `tests/big-brain.test.ts`, in the same style as `tests/agent-forum.test.ts`, covering `lib/big-brain.ts`: transcript condensing and
  capping, marker slicing, secret scan, lock acquire/stale-break, citation format.
- Manual end-to-end: run a short session in a scratch git repo, quit, confirm the child ran, the pages and index were
  written with citations, the global wiki committed, the project wiki left uncommitted, and the next session's system
  prompt contains the indexes.
- Injection: the block is present for a worker session (`ORCA_TERMINAL_HANDLE=structworker_x`) and absent under
  `PI_BIG_BRAIN=off`; links are absolute; each index is capped at 2 KB.

## Out of scope (v1)

- Separate lint pass (the rewrite does dedupe and supersede).
- Search tool or embeddings.
- Back-filling the existing 539 session dirs (catch-up only covers sessions registered after install; a one-off
  backfill can come later).
- Writing into bd.
- Digesting every N turns or on idle.
- Installing pi-memory, pi-blackhole or similar packages.

## Status History

- 2026-11-21 19:00 WIB: Waiting approval (reconstructed; header added at approval)
- 2026-11-21 21:29 WIB: Approved
