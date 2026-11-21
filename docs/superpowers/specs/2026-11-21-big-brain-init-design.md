# big-brain init: cold-start a project wiki from past sessions

**Status:** Approved (since 2026-11-21 22:40 WIB)

## Problem

big-brain only digests sessions registered after it was installed. A project that already has days of work (sme-desk: 15 of
Chandra's own sessions over 2 days, plus 27 Orca workers) starts with an empty wiki, and its lessons stay locked in old
transcripts. The updater, supervisor, locking and validation already exist (`docs/superpowers/specs/2026-11-21-big-brain-design.md`).
The only missing piece is choosing old sessions and handing them to that machinery.

## Command

`/big-brain-init [N] [days]`, run inside the project. Defaults: N = 20 sessions, days = 30.

1. `projectRoot` = the main checkout of `ctx.cwd` (existing `mainCheckout`). Not a git repo → notify an error and stop.
2. Find candidates (below), rank them, keep the top N.
3. Show `ctx.ui.confirm`: "Import K sessions (about C updater calls, background) into `<projectRoot>/.pi/wiki` and the
   global wiki?" With 0 candidates, notify "nothing to import" and stop.
4. On yes:
   - `mkdir -p <projectRoot>/.pi/wiki`. Running init counts as opting the repo in, and the folder is left untracked.
   - Write a registration record for each picked session.
   - Spawn the existing catch-up supervisor for `projectRoot`.
   - Notify where to watch: `git -C ~/.pi/agent/wiki log`, `<projectRoot>/.pi/wiki/`, `~/.pi/agent/wiki-state/log`.

Arguments must be positive integers. Anything else notifies the usage line and stops.

## Candidates

A session file is a candidate when all of these hold:

- **Same project.** Its session header `cwd` equals or is inside `projectRoot` or one of its live worktrees (the `worktree`
  lines of `git -C <projectRoot> worktree list --porcelain`). Sessions from deleted worktrees aren't matched.
  - Only the header of one file per session dir is read to match the dir, since a dir holds a single cwd.
- **Recent.** Modified within `days`.
- **Not a worker.** The first user message fails the existing `workerPrompt` check (Orca dispatched-worker preamble, `<paseo-system`).
- **At least 2 user messages** (the existing minimum).
- **Not already registered** (no `sessions/<sha1>.json`). This covers the current session and earlier imports, so re-running init is safe.

**Ranking:** by the number of Chandra's messages, descending, with ties broken by newest first.

**Cost shown in the confirm:** the sum of `chunk(condense(entries)).length` over the picks. It is the same split the
supervisor uses, so the number matches the real calls.

## Registration and digest

- **Records:** imported sessions get `{sessionFile, projectRoot, pid: 0}`. No process owns them, so they are always dead.
  `pidAlive` treats `pid <= 0` as dead, because `process.kill(0, 0)` signals the caller's own process group and would read as alive.
- **Order:** catch-up digests picked sessions oldest first, sorted by session file basename (which starts with an ISO
  timestamp). Newer facts then overwrite older ones, as the updater rules expect. This also fixes catch-up's current
  readdir (sha1) order.
- **Everything else is unchanged:** chunking, the staging copy, the guard, validation, preflight, the global commit,
  markers, failures and skipped. Imported sessions show up in `state.json` like any other.

**Lock contention.** The whole import runs inside one supervisor holding the flock, which can take 1–2 hours at about
25 calls. Quit or compact triggers from other sessions meanwhile exit quietly with code 75. Their sessions stay
registered and are picked up by the next catch-up. If the init spawn itself finds the lock held, the imported records
wait for the next catch-up in that project. The notify says so when that happens: the command checks the lock with
`flock -n` before spawning.

## Code

| File | Change |
|---|---|
| `lib/big-brain.ts` | `rankInit(cands, n)`: pure ranking (user count descending, then newest). |
| `extensions/big-brain.ts` | Register `/big-brain-init` (args, scan, confirm, mkdir, register, spawn). The candidate scan is a small helper in the same file. |
| `lib/big-brain-run.ts` | `pidAlive`: `pid <= 0` means dead. Catch-up `picked` sorted by basename. |
| `README.md` | Two lines in the big-brain section. |

## Testing

- `rankInit`: order by user count, ties by newest, cut at N.
- **Candidate scan** with a temp HOME and sessions dir. It covers:
  - main checkout and linked worktree dirs matched
  - an unrelated repo dir skipped
  - a deleted-worktree dir skipped
  - a worker preamble skipped
  - a 1-user-message session skipped
  - an already-registered session skipped
  - a session older than `days` skipped
- **Command:**
  - not a repo → error
  - 0 candidates → notify
  - confirm declined → nothing written
  - confirm accepted → `.pi/wiki` created, records with `pid: 0`, one catch-up spawn
  - bad args → usage
- **Supervisor:**
  - a `pid: 0` record is picked by catch-up
  - two records are digested in timestamp order
- **Manual:** run `/big-brain-init` in sme-desk once after merge and check the confirm count. Expected: 15 sessions,
  27 calls, with the defaults covering all of them.

## Out of scope

- Filtering by a model ("is this session useful"). The updater already defaults to writing nothing, and the user picked
  ranking by message count.
- A picker UI, progress UI or cancel command. Cancel today: `pkill -f big-brain-run`. Markers make it resumable.
- Importing sessions from deleted worktrees, or other projects' sessions.
- Changing `N`/`days` defaults per repo.

## Status History

- 2026-11-21 22:39 WIB: Waiting approval
- 2026-11-21 22:40 WIB: Approved
