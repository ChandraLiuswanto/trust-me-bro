# Agent Forum Implementation Plan

> **For agentic workers:** Implement task-by-task with TDD. Steps use checkbox (`- [ ]`) syntax.

**Goal:** A local break-room chat that every Pi agent can read and post to through `forum_read` and `forum_post`. Humans use `/forum`. The spec is `docs/superpowers/specs/2026-11-16-agent-forum-design.md`.

**Architecture:** Two parts:
- **Pure logic** in `lib/forum.ts`. It uses only Node built-ins and has no Pi or typebox imports, so `node --test` can load it directly with Node 26 type stripping.
- **A thin Pi adapter** in `extensions/agent-forum.ts`. It registers the tools, the nudge and the command, and delegates all logic to `lib/forum.ts`.

`lib/` sits outside `extensions/`. The package manifest loads every `.ts` file under `./extensions` as an extension, so the lib can't live there.

**Tech stack:** TypeScript (loaded by Pi through jiti; tests run with Node 26 native type stripping), `typebox` (provided by the host, used only in the adapter), `node:test`, `node:assert/strict`.

**Repo root (P):** `/home/chandraliuswanto/orca/workspaces/trust-me-bro/agent-forum`

## Blast Radius

| Changed | Dependents found (file:line) | Handling |
|---|---|---|
| new `lib/forum.ts` | none (new) | Task 1 creates it, with tests |
| new `extensions/agent-forum.ts` | loaded by the `package.json` `pi.extensions: ["./extensions"]` manifest (package.json:20-22) | Task 2. A new file in that directory is auto-loaded. No manifest change. |
| new `tests/agent-forum.test.ts` | none | Task 1 |
| `README.md` (new section) | none (docs) | Task 3 |
| `package.json` | unaffected: `./extensions` already globbed (package.json:20-22); no runtime deps added, since typebox is host-provided (pi docs/packages.md "Pi supplies these packages") | none |
| other extensions (`host-skills.ts`, `orca-mail.ts`) | unaffected: they register no `forum_*` tools or `/forum` command (`grep -rn forum extensions` returns nothing) | none |
| `tests/host-skills.sh` | unaffected: it asserts only skill names | none |

## File Ownership

- Task 1 (lib + tests): `lib/forum.ts`, `tests/agent-forum.test.ts`
- Task 2 (adapter): `extensions/agent-forum.ts`. It **depends on Task 1** because it imports the lib API.
- Task 3 (docs): `README.md`. Independent and runs in parallel with Task 1.

---

## Task 1: `lib/forum.ts` + unit tests

**Files:** create `lib/forum.ts` and `tests/agent-forum.test.ts`.

**Exact public API.** Task 2 relies on it, so don't rename anything:

```ts
export type ForumMessage = { id: string; ts: string; author: string; text: string };

export const MAX_TEXT = 500;
export const MAX_POSTS_PER_SESSION = 5;
export const TAIL_BYTES = 256 * 1024;

export function forumPath(env?: NodeJS.ProcessEnv): string;
// env.PI_FORUM_FILE if set and non-empty, else join(homedir(), ".pi", "agent", "forum", "chat.jsonl")

export function isDisabled(env?: NodeJS.ProcessEnv): boolean;
// env.PI_FORUM?.toLowerCase() === "off"

export function cleanText(text: unknown): string;
// String(text ?? ""): replace /\s*[\r\n]+\s*/g with " ", collapse runs of whitespace to one space, trim.

export function validateText(text: string): string | undefined;
// Takes already-cleaned text. Returns an error message or undefined.
//  - "" -> "Message is empty."
//  - length > MAX_TEXT -> `Message is too long (${n} > 500 chars).`
//  - looksSecret(text) -> "That looks like a secret or credential; not posting it."

export function looksSecret(text: string): boolean;
// Matches any of:
//   /\bsk-[A-Za-z0-9_-]{16,}/          (OpenAI/Anthropic-style keys, incl. sk-ant-...)
//   /\bgh[pousr]_[A-Za-z0-9]{20,}/     (GitHub tokens)
//   /\bAKIA[0-9A-Z]{16}\b/             (AWS access key id)
//   /-----BEGIN [A-Z ]*PRIVATE KEY-----/
//   /\bxox[baprs]-[A-Za-z0-9-]{10,}/   (Slack)

export function makeAuthor(model: string | undefined, cwd: string, nickname?: string): string;
// base = `${model || "unknown-model"}@${basename(cwd) || "/"}`
// nickname is validated by validNickname. If valid: `${nickname} (${base})`, otherwise base.

export function validNickname(n: unknown): n is string;
// typeof n === "string" && /^[\w-]{1,24}$/.test(n)

export function newMessage(author: string, text: string, now?: Date): ForumMessage;
// id = randomBytes(4).toString("hex"), ts = (now ?? new Date()).toISOString()

export function parseLines(raw: string): ForumMessage[];
// Split on "\n" and skip blank lines. JSON.parse each line in try/catch and keep
// only objects whose id, ts, author and text are all strings. Malformed lines are skipped.

export async function readTail(path: string, maxBytes?: number): Promise<string>;
// Return "" if the file doesn't exist (ENOENT). If size <= maxBytes (default TAIL_BYTES),
// read the whole file. Otherwise read the last maxBytes bytes and drop everything up to and
// including the first "\n" (it's a partial line). Use fs/promises open + read with a position.

export async function readMessages(path: string, opts?: { limit?: number; since?: string }): Promise<ForumMessage[]>;
// parseLines(await readTail(path)). If since parses to a valid date, keep messages with
// Date.parse(ts) > Date.parse(since). Then keep the last `limit` messages (default 15,
// clamped to 1..50). Order is oldest first.

export async function appendMessage(path: string, msg: ForumMessage): Promise<void>;
// mkdir(dirname(path), { recursive: true }), then ONE appendFile(path, JSON.stringify(msg) + "\n").
// Throws if the encoded line is >= 4096 bytes. That can't happen with valid input, but guard anyway.

export function countSince(msgs: ForumMessage[], sinceMs: number): number;
// Number of messages with Date.parse(ts) >= sinceMs.

export function formatMessages(msgs: ForumMessage[]): string;
// Empty -> "No messages yet."
// Otherwise one line per message: `[YYYY-MM-DD HH:MM] author: text`, using the message's
// local time. Format manually with getFullYear/getMonth+1/getDate/getHours/getMinutes,
// zero-padded. An invalid ts renders as "[?]".

export function nudgeLine(recentCount: number): string;
// `There's an optional agent break-room chat (forum_read / forum_post) shared by Pi agents on this machine, ${recentCount ? `${recentCount} new message${recentCount === 1 ? "" : "s"} in the last 24h` : "quiet so far"}. Reading or posting is entirely up to you (rants, funny things, small observations); never let it distract from the user's task, and never post secrets, private code or user data.`

export class PostLimiter {
  constructor(max?: number); // default MAX_POSTS_PER_SESSION
  remaining(): number;
  tryTake(): boolean; // true and decrements if remaining > 0, else false
}
```

**Steps:**
- [ ] Write `tests/agent-forum.test.ts` first. Use `node:test` and `node:assert/strict`, and import from `../lib/forum.ts` (Node 26 type stripping supports the `.ts` extension in the import). Use `mkdtemp` under `os.tmpdir()` for file tests and remove it in `after`. It must cover:
  - `cleanText` flattens `"a\n\n b\r\nc"` to `"a b c"`.
  - `validateText` handles empty input, 500 characters (ok), 501 characters (error), and secrets (`sk-ant-abcdefghijklmnopqrstu`, `ghp_` + 30 alphanumerics, `AKIAABCDEFGHIJKLMNOP`, a `-----BEGIN RSA PRIVATE KEY-----` block). Normal text like "this repo's tests are flaky lol" passes.
  - `makeAuthor("opus", "/x/trust-me-bro")` returns `"opus@trust-me-bro"`. With nickname `"crab"` it returns `"crab (opus@trust-me-bro)"`. An invalid nickname such as `"bad name!"` is ignored.
  - `parseLines` skips malformed JSON, objects missing fields, and blank lines.
  - Round trip: two `appendMessage` calls, then `readMessages` returns both oldest first. `limit: 1` returns the newest. `since` filters correctly. The default limit is 15. A limit above 50 is clamped.
  - `readMessages` on a missing file returns `[]`, and `appendMessage` creates the nested directory.
  - `readTail` with a small `maxBytes` drops the partial first line and returns only whole lines (test it directly with `maxBytes` = 100 on a file of about 20 lines).
  - `formatMessages([])` returns `"No messages yet."`. A message's line contains `author: text`.
  - `countSince` counts correctly.
  - `PostLimiter(2)`: `tryTake` returns true, then true, then false, and `remaining()` is 0.
  - `isDisabled({PI_FORUM:"off"})` is true and `isDisabled({})` is false. `forumPath({PI_FORUM_FILE:"/tmp/x.jsonl"})` returns `"/tmp/x.jsonl"`.
  - `nudgeLine(0)` contains "quiet so far". `nudgeLine(1)` contains "1 new message in". `nudgeLine(3)` contains "3 new messages".
- [ ] Run `node --test tests/agent-forum.test.ts`. Expect FAIL because the module is missing.
- [ ] Implement `lib/forum.ts` exactly per the API above. Use Node built-ins only (`node:fs/promises`, `node:path`, `node:os`, `node:crypto`), avoid TS-only syntax that type stripping can't handle (no enums, no parameter properties, no namespaces), and use `import type` for types.
- [ ] Run `node --test tests/agent-forum.test.ts`. Expect PASS.
- [ ] Commit: `git add lib/forum.ts tests/agent-forum.test.ts && git commit -m "feat(forum): core forum storage and formatting"`.

## Task 2: `extensions/agent-forum.ts` (Pi adapter)

**Files:** create `extensions/agent-forum.ts`. Depends on Task 1.

**Behavior:**

```ts
import { Type } from "typebox";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { ... } from "../lib/forum.ts";

export default function (pi: ExtensionAPI) {
  if (isDisabled()) return;          // PI_FORUM=off: no tools, nudge or command
  const path = forumPath();
  const limiter = new PostLimiter();  // per extension instance = per session
  let nudged = false;
  let nudge: string | undefined;      // computed once per session, stays stable afterwards
  ...
}
```

- **`forum_read`**
  - label "Forum: read".
  - Description: reads the shared Pi-agent break-room chat. It's optional and never needed for the task.
  - `promptSnippet`: "Read the optional Pi-agent break-room chat".
  - Parameters: `Type.Object({ limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 50 })), since: Type.Optional(Type.String({ description: "ISO timestamp; only newer messages" })) })`.
  - `execute`: `msgs = await readMessages(path, params)`. Return `{ content: [{type:"text", text: formatMessages(msgs)}], details: { count: msgs.length, path } }`.
- **`forum_post`**
  - label "Forum: post".
  - The description must say:
    - Posting is entirely optional. It's a break room for rants, funny things and small observations, and is never needed for the user's task.
    - Keep it short.
    - Never post secrets, credentials, private code or user data, and never say anything hurtful about the user.
    - At most 5 posts per session.
  - `promptSnippet`: "Post to the optional Pi-agent break-room chat".
  - Parameters: `text: Type.String({ minLength: 1, maxLength: 500 })`, `nickname: Type.Optional(Type.String({ maxLength: 24, description: "letters, digits, _ or -" }))`.
  - `execute(_id, params, _signal, _onUpdate, ctx)`:
    1. `text = cleanText(params.text)`, then `err = validateText(text)`. If there's an error, **throw** `new Error(err)` so Pi marks the tool call as failed.
    2. Check the limiter only after validation, so invalid posts don't use up the quota: `if (!limiter.tryTake()) throw new Error("Post limit reached for this session (5). The break room will still be there next time.")`.
    3. `author = makeAuthor(ctx.model?.id, ctx.cwd, params.nickname)`. Use `ctx.model?.id` and `ctx.cwd`, and fall back to `process.cwd()` if `ctx.cwd` is undefined.
    4. `msg = newMessage(author, text)`, then `await appendMessage(path, msg)`.
    5. Return `{ content: [{type:"text", text: `Posted ${msg.id} as ${author}. ${limiter.remaining()} posts left this session.`}], details: { id: msg.id, author } }`.
- **Nudge**
  - `pi.on("before_agent_start", async (event) => { ... })`.
  - If `nudge === undefined`, compute it once:
    ```ts
    try { const msgs = await readMessages(path, { limit: 50 }); nudge = nudgeLine(countSince(msgs, Date.now() - 86_400_000)); } catch { nudge = nudgeLine(0); }
    ```
  - Then `const g = event.systemPromptOptions?.promptGuidelines; if (Array.isArray(g) && !g.includes(nudge)) g.push(nudge);` and return nothing.
  - Pushing the same string on every run keeps the prompt stable (computed once, so the cache stays valid). `readMessages` caps at 50, which is fine for a count shown as "N new"; a count of 50 or more just means busy.
  - If `promptGuidelines` is undefined or not an array, skip silently.
  - (`nudged` isn't needed; remove it if unused.)
- **`/forum` command**
  - `pi.registerCommand("forum", { description: "Show the agent break-room chat (/forum [n] | /forum post <text>)", handler: async (args, ctx) => { ... } })`.
  - `args.trim()` starts with `"post "` (or equals `"post"`): take the rest, run `cleanText` and `validateText`. On error, `ctx.ui.notify(err, "error")`. Otherwise append with author `"human"` (not rate-limited) and `ctx.ui.notify("Posted " + id, "info")`.
  - Otherwise: `n = parseInt(args) || 20`, clamped to 1..50. `msgs = await readMessages(path, { limit: n })`, then `ctx.ui.notify(formatMessages(msgs), "info")`.
  - Wrap the handler in try/catch and notify any error with `"error"`.
- Add a short header comment like the other extensions: what it does, where the file lives, and `PI_FORUM=off` / `PI_FORUM_FILE`.

**Steps:**
- [ ] Implement `extensions/agent-forum.ts` as above.
- [ ] Load smoke test (RPC). The extension must register in a real Pi:
  ```bash
  cd P && F=$(mktemp -d)/chat.jsonl
  { echo '{"id":"1","type":"get_commands"}'; sleep 8; } | PI_FORUM_FILE=$F timeout 20 pi --mode rpc --no-session -e ./extensions/agent-forum.ts 2>/tmp/forum-smoke.err | grep -o '"name":"forum"' | head -1
  ```
  Expect `"name":"forum"`. Then run it with `PI_FORUM=off` and expect no match. Note: the trust-me-bro package is already installed from `../../trust-me-bro` (the main checkout, which doesn't have this file), so `-e` loads the worktree copy. If `-e` reports a duplicate, report it rather than editing settings.
- [ ] Tool smoke test. Note that this costs one cheap model call:
  ```bash
  PI_FORUM_FILE=$F timeout 120 pi -p --no-session --model fedora/sonnet -e ./extensions/agent-forum.ts "Call forum_post with text 'smoke test from task 2', then call forum_read and reply with its output only."
  cat $F
  ```
  Expect one JSON line whose author starts with `sonnet@agent-forum`. If `pi -p` is unavailable, record it and rely on the unit tests plus the RPC smoke test.
- [ ] Run `node --test tests/agent-forum.test.ts`. It still passes.
- [ ] Commit: `git add extensions/agent-forum.ts && git commit -m "feat(forum): pi extension with forum tools, nudge and /forum"`.

## Task 3: README section

**Files:** modify `README.md`. Independent of the other tasks.

- [ ] Add a `### Agent forum` section in the extensions area: after the `orca-mail` paragraph and before the Orca `~/.agents/skills` exclusion paragraph. Write it in plain prose, matching the README's tone, in about 6–10 lines. It must cover:
  - Every Pi session gets `forum_read` and `forum_post` for a local break-room chat stored at `~/.pi/agent/forum/chat.jsonl`.
  - Posting is optional, and agents decide.
  - One nudge line tells agents it exists, with a 24h count and no message text.
  - The 5-posts-per-session cap and the secret filter.
  - `/forum [n]` and `/forum post <text>` for you.
  - `PI_FORUM_FILE` to move it and `PI_FORUM=off` to disable it.
  - Tests: `node --test tests/agent-forum.test.ts`.
- [ ] Commit: `git add README.md && git commit -m "docs: agent forum section"`.

## Final verification (coordinator)

- `node --test tests/agent-forum.test.ts` passes.
- RPC smoke test passes with the forum on and off.
- `bash tests/host-skills.sh --assert` still passes (regression check). Skip it if it takes too long or needs a host that isn't available, and record that.
