import { test, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, mkdir, rm, writeFile, readdir, realpath } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import bigBrain, { mainCheckout } from "../extensions/big-brain.ts";

const dir = await realpath(await mkdtemp(join(tmpdir(), "big-brain-ext-")));
after(() => rm(dir, { recursive: true, force: true }));
const home = join(dir, "home");
await mkdir(join(home, ".pi", "agent", "wiki"), { recursive: true });
await writeFile(join(home, ".pi", "agent", "wiki", "index.md"), "- [x](lesson-x.md) a lesson\n");
const realHome = process.env.HOME;
after(() => (process.env.HOME = realHome));
beforeEach(() => {
  process.env.HOME = home;
  delete process.env.PI_BIG_BRAIN;
  delete process.env.ORCA_TERMINAL_HANDLE;
});

const git = (cwd: string, ...args: string[]) => execFileSync("git", args, { cwd, stdio: "ignore" });

test("mainCheckout returns the main path from a linked worktree, null outside a repo", async () => {
  const repo = join(dir, "repo");
  await mkdir(repo);
  git(repo, "init", "-q");
  git(repo, "-c", "user.name=t", "-c", "user.email=t@t", "commit", "-q", "--allow-empty", "-m", "x");
  git(repo, "worktree", "add", "-q", join(dir, "wt"));
  assert.equal(mainCheckout(join(dir, "wt")), repo);
  assert.equal(mainCheckout(home), null);
});

function load(hasUI = true) {
  const handlers: Record<string, Function> = {};
  const spawns: string[][] = [];
  bigBrain({ on: (e: string, h: Function) => (handlers[e] = h) } as any, (a) => spawns.push(a));
  const ctx = { cwd: home, hasUI, sessionManager: { getSessionFile: () => join(dir, "s.jsonl") } };
  const run = async (prompt: string) => {
    const event = { prompt, systemPromptOptions: { sections: {} as Record<string, string> } };
    await handlers.session_start?.({ reason: "startup" }, ctx);
    assert.equal(await handlers.before_agent_start?.(event, ctx), undefined);
    return event.systemPromptOptions.sections["memory-wiki"];
  };
  return { handlers, spawns, ctx, run };
}
const regs = async () => readdir(join(home, ".pi", "agent", "wiki-state", "sessions")).catch(() => []);

test("worker session gets the block but is not registered", async () => {
  process.env.ORCA_TERMINAL_HANDLE = "structworker_x";
  const { run, spawns } = load();
  assert.match(await run("hi"), /^## Memory wiki/);
  assert.deepEqual(await regs(), []);
  assert.deepEqual(spawns, []);
});

test("PI_BIG_BRAIN=off registers nothing", async () => {
  process.env.PI_BIG_BRAIN = "off";
  const { handlers } = load();
  assert.deepEqual(Object.keys(handlers), []);
});

test("digestible session registers once and spawns on compact and shutdown", async () => {
  const { run, spawns, handlers, ctx } = load();
  assert.match(await run("hi"), /lesson-x\.md/);
  await handlers.before_agent_start({ prompt: "again", systemPromptOptions: { sections: {} } }, ctx);
  assert.equal((await regs()).length, 1);
  assert.deepEqual(spawns, [["--mode", "catchup"]]);
  await handlers.session_compact({}, ctx);
  await handlers.session_shutdown({ reason: "reload" }, ctx);
  await handlers.session_shutdown({ reason: "quit" }, ctx);
  const file = join(dir, "s.jsonl");
  assert.deepEqual(spawns.slice(1), [
    ["--mode", "session", "--session", file],
    ["--mode", "session", "--session", file],
    ["--mode", "session", "--session", file, "--final"],
  ]);
});

test("no UI: not registered", async () => {
  const { run, spawns } = load(false);
  await rm(join(home, ".pi", "agent", "wiki-state"), { recursive: true, force: true });
  assert.ok(await run("hi"));
  assert.deepEqual(await regs(), []);
  assert.deepEqual(spawns, []);
});
