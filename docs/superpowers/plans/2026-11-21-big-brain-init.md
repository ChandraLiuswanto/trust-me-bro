# big-brain init Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** `/big-brain-init [N] [days]` registers the top-N past sessions of the current project, so the existing catch-up supervisor digests them into the wikis.

**Spec:** [docs/superpowers/specs/2026-11-21-big-brain-init-design.md](../specs/2026-11-21-big-brain-init-design.md) (Approved). The spec wins on conflict. The base design is [2026-11-21-big-brain-design.md](../specs/2026-11-21-big-brain-design.md).

**Architecture:** A pure ranking helper lives in `lib/big-brain.ts`. The candidate scan and the command live in `extensions/big-brain.ts`. Two small supervisor fixes go in `lib/big-brain-run.ts`. There is no new file except tests.

**Tech stack:** Node v26 (`.ts` runs directly), `node:test`, the Pi extension API (`pi.registerCommand`, `ctx.ui.confirm`, `ctx.ui.notify`).

## Conventions

- **Code style:** use `.ts` extension imports, the same style as the existing big-brain files, and the existing helpers: `parseEntries`, `userCount`, `workerPrompt`, `condense`, `chunk`, `regFile`, `writeAtomic`, `projectWiki`, `stateDir`, `mainCheckout`, `spawnSupervisor`.
- **No real HOME in tests:** tests set `process.env.HOME` to a temp dir, as in `tests/big-brain-ext.test.ts:14-20`, and never touch the real `~/.pi`.
- **Test command:** `node --test tests/*.test.ts`. 58 tests pass today.

## File ownership

| File | Task |
|---|---|
| `lib/big-brain-run.ts`, `tests/big-brain-run.test.ts` | 1 |
| `lib/big-brain.ts`, `extensions/big-brain.ts`, `tests/big-brain.test.ts`, `tests/big-brain-ext.test.ts` | 2 |
| `README.md` | 3 |

The three tasks touch disjoint files and all run in parallel. Task 2 depends on Task 1 at runtime only: Task 1 makes catch-up accept `pid: 0`. The code doesn't depend on it, so Task 2's tests need nothing from Task 1.

## Blast Radius

| Changed | Dependents found (file:line) | Handling |
|---|---|---|
| `realDeps.pidAlive` (`lib/big-brain-run.ts:274`) | Its only caller is the catch-up filter at `lib/big-brain-run.ts:235`. Tests inject their own (`tests/big-brain-run.test.ts:43`) | Task 1: `pid <= 0` means dead. It is exported as `pidAlive` so it can be tested. No other caller (grep `pidAlive`: 3 hits, all listed). |
| Catch-up `picked` order (`lib/big-brain-run.ts:231-235`) | `digest()` loop at `:236`. The test "catch-up skips live pid…" (`tests/big-brain-run.test.ts:~284`) asserts call counts, not order | Task 1 sorts by `basename(sessionFile)` in catch-up only. The existing test is unaffected because it asserts a single call. A new order test is added. |
| `extensions/big-brain.ts` default export (adds `registerCommand`) | Loaded by Pi via `package.json` `pi.extensions`. The test fake `pi` in `tests/big-brain-ext.test.ts:37` has only `on` | Task 2 adds `registerCommand` to the test fake. Under `PI_BIG_BRAIN=off` the factory still returns before registering anything, so the command is absent too, matching the existing test at `:57`. |
| Command name `/big-brain-init` | Other registered commands: only `forum` (`extensions/agent-forum.ts:89`) | No clash. |
| `lib/big-brain.ts` (adds `rankInit`) | Imported by the extension, the supervisor and the tests | Additive export, so existing importers are unaffected. |
| `<projectRoot>/.pi/wiki/` creation | The supervisor stages a project wiki only if it exists (`runChunk`). Injection reads it at `session_start` | This is intended by the spec. A session that is already open sees the new wiki's index only after its next `session_start`. |
| `README.md` big-brain section (`README.md:112-127`) | Docs | Task 3. |

## Task 1: supervisor fixes (`lib/big-brain-run.ts`)

**Files:** modify `lib/big-brain-run.ts` and `tests/big-brain-run.test.ts`.

1. Extract the liveness check as `export function pidAlive(pid: number): boolean`. It returns `false` when `pid <= 0` or the pid isn't an integer. Otherwise it keeps the current behaviour: `process.kill(pid, 0)`, and on error `true` only for EPERM. `realDeps.pidAlive` uses it.
2. In catch-up mode only, sort `picked` by `basename(r.sessionFile)` ascending. Session filenames start with an ISO timestamp, so this is oldest first. Leave session mode unchanged.

- [ ] **Step 1: Failing tests.**
  - `pidAlive(0) === false`, `pidAlive(-1) === false`, `pidAlive(process.pid) === true`.
  - Catch-up with two dead records `2026-01-02T…_b.jsonl` and `2026-01-01T…_a.jsonl`, registered in reverse order, digests `a` first. Assert on the order of `runChild` prompts; the transcript text differs per session.
  - A record with `pid: 0` is picked by catch-up, using the real `pidAlive` in deps.
- [ ] **Step 2:** Run the tests and confirm they fail. **Step 3:** Implement. **Step 4:** `node --test tests/*.test.ts` passes.
- [ ] **Step 5:** Commit `fix(big-brain): pid 0 is dead; catch-up digests oldest first`.

## Task 2: `/big-brain-init` command (`lib/big-brain.ts`, `extensions/big-brain.ts`)

**Files:** modify `lib/big-brain.ts`, `extensions/big-brain.ts`, `tests/big-brain.test.ts` and `tests/big-brain-ext.test.ts`.

**`lib/big-brain.ts`:**

```ts
export type Candidate = { sessionFile: string; users: number; mtimeMs: number; calls: number };
export function rankInit(c: Candidate[], n: number): Candidate[]; // users desc, then mtimeMs desc; first n
```

**`extensions/big-brain.ts`:**

```ts
export function initCandidates(projectRoot: string, days: number, home: string, now: number, exclude: string | undefined): Candidate[];
```

`initCandidates` works like this:

- **Session root:** `join(home, ".pi", "agent", "sessions")`.
- **Project match:** compute the roots from the `worktree ` lines of `git -C projectRoot worktree list --porcelain`, the main checkout plus live worktrees. A dir is in the project when the header `cwd` of its first `*.jsonl` file (the first line, `type: "session"`) equals a root or starts with `root + "/"`. Unreadable dirs and files are skipped.
- **Per file in a matching dir**, all of these must hold:
  - `mtimeMs >= now - days*864e5`
  - `sessionFile !== exclude` (the current session)
  - `!existsSync(regFile(home, sessionFile))`
  - `parseEntries(raw)` succeeds
  - the first `user` message text fails `workerPrompt` (text parts joined, as `condense` does)
  - `userCount(entries) >= 2`
- **`calls`:** `chunk(condense(entries), entries.at(-1)!.id).length`.

**Command:** `pi.registerCommand("big-brain-init", { description: "Import past sessions of this project into the memory wikis: /big-brain-init [N=20] [days=30]", handler })`. Register it inside the factory, after the `isOff()` early return. The handler:

1. Parse the args with `args.trim().split(/\s+/).filter(Boolean)`. Both are optional and must be positive integers (`/^[1-9]\d*$/`). Otherwise `ctx.ui.notify("Usage: /big-brain-init [N] [days]", "error")` and return.
2. `root = mainCheckout(ctx.cwd)`. If it is null, notify "Not in a git repo" (error) and return.
3. `picks = rankInit(initCandidates(root, days, homedir(), Date.now(), ctx.sessionManager.getSessionFile()), n)`. If it is empty, notify "Nothing to import" (info) and return.
4. Confirm with `ctx.ui.confirm("Import past sessions?", "Import ${picks.length} sessions (about ${sum calls} updater calls, in the background) into ${projectWiki(root)} and the global wiki?")`. If declined, return with nothing written.
5. `mkdirSync(projectWiki(root), { recursive: true })`. Then for each pick, `await writeAtomic(regFile(homedir(), f), JSON.stringify({ sessionFile: f, projectRoot: root, pid: 0 }))`.
6. Check the lock without blocking: `spawnSync("flock", ["-n", join(stateDir(), "lock"), "true"]).status === 0` means free. Then `run(["--mode", "catchup", "--project", root])`.
7. Notify (info). Free: "Importing N sessions in the background. Watch: git -C ~/.pi/agent/wiki log, <projectWiki>, ~/.pi/agent/wiki-state/log". Held: "…registered; another big-brain run is active, so they will be digested at the next catch-up in this project."
8. The whole handler is wrapped in try/catch, with `notify(String(e), "error")`.

- [ ] **Step 1: Failing tests.**
  - **`tests/big-brain.test.ts` (`rankInit`):** order by users, ties by newest mtime, cut at n.
  - **`tests/big-brain-ext.test.ts`:** extend the fake `pi` with `registerCommand: (name, o) => (commands[name] = o)` and a fake `ctx.ui` that has `notify` (records the calls) and `confirm` (returns a preset answer). Build the temp `home/.pi/agent/sessions/<dir>/*.jsonl` fixtures with the header `cwd` and messages. The repo is a temp git repo with a linked worktree.
  - **`initCandidates`:**
    - main checkout and worktree dirs matched
    - an unrelated cwd skipped
    - a cwd of a deleted worktree (a plain dir path not in the list) skipped
    - a worker preamble skipped
    - a 1-user-message session skipped
    - a registered session skipped
    - an old mtime (`utimes`) skipped
    - the `exclude` file skipped
    - `calls >= 1`
  - **Command:**
    - bad args → usage error, nothing written
    - not a repo → error
    - 0 candidates → "Nothing to import"
    - declined → no `.pi/wiki`, no records, no spawn
    - accepted → `.pi/wiki` exists, records with `pid: 0`, exactly one spawn `["--mode","catchup","--project",root]`, notify contains "Importing"
    - `PI_BIG_BRAIN=off` → no command registered
- [ ] **Step 2:** Run the tests and confirm they fail. **Step 3:** Implement. **Step 4:** `node --test tests/*.test.ts` passes.
- [ ] **Step 5:** Commit `feat(big-brain): /big-brain-init imports past sessions`.

## Task 3: README

**Files:** modify `README.md`, adding about two lines to the big-brain section (around lines 112-127) in the same voice. Cover `/big-brain-init [N] [days]` (default 20 sessions, 30 days, ranked by your message count, creates `.pi/wiki`, runs in the background) and the cancel command `pkill -f big-brain-run` (it resumes later).

- [ ] **Step 1:** Write it. **Step 2:** Commit `docs(big-brain): /big-brain-init`.

## Manual check (coordinator, after merge, on the user's choice)

Run `/big-brain-init` in a `/data/projects/sme-desk` session. Expect the confirm to show 15 sessions and about 27 calls. Decline it unless the user wants the real import.
