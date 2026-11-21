import { test, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawn, spawnSync } from "node:child_process";
import { mkdtemp, mkdir, rm, writeFile, readdir, readFile, realpath, utimes } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import bigBrain, { mainCheckout, initCandidates } from "../extensions/big-brain.ts";
import { regFile, writeAtomic } from "../lib/big-brain.ts";

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
  bigBrain({ on: (e: string, h: Function) => (handlers[e] = h), registerCommand: () => {} } as any, (a) => spawns.push(a));
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

// fresh home + repo (with linked worktree) + session fixtures per test
let n = 0;
async function project() {
  const base = join(dir, `init${n++}`);
  const home = join(base, "home");
  const proj = join(base, "proj");
  const wt = join(base, "proj-wt");
  await mkdir(proj, { recursive: true });
  git(proj, "init", "-q");
  git(proj, "-c", "user.name=t", "-c", "user.email=t@t", "commit", "-q", "--allow-empty", "-m", "x");
  git(proj, "worktree", "add", "-q", wt);
  process.env.HOME = home;
  const sessions = join(home, ".pi", "agent", "sessions");
  const session = async (d: string, name: string, cwd: string, users: string[]) => {
    await mkdir(join(sessions, d), { recursive: true });
    const lines = [{ type: "session", id: "h", cwd }, ...users.map((t, i) => ({ type: "message", id: `u${i}`, message: { role: "user", content: t } }))];
    const f = join(sessions, d, name);
    await writeFile(f, lines.map((l) => JSON.stringify(l)).join("\n") + "\n");
    return f;
  };
  return { base, home, proj, wt, session };
}

test("initCandidates matches main and worktree dirs and applies the skip rules", async () => {
  const { base, home, proj, wt, session } = await project();
  const two = ["hello", "more"];
  const main = await session("a", "2026-01-01_main.jsonl", proj, [...two, "third"]);
  await session("a", "2026-01-02_one.jsonl", proj, ["only one"]);
  await session("a", "2026-01-03_worker.jsonl", proj, [PREAMBLE_TEXT, "x"]);
  const old = await session("a", "2026-01-04_old.jsonl", proj, two);
  await utimes(old, new Date(0), new Date(0));
  const reg = await session("a", "2026-01-05_reg.jsonl", proj, two);
  await writeAtomic(regFile(home, reg), "{}");
  const excl = await session("a", "2026-01-06_excl.jsonl", proj, two);
  const inWt = await session("b", "2026-01-01_wt.jsonl", join(wt, "sub"), two);
  await session("c", "2026-01-01_other.jsonl", join(base, "projx"), two);
  await session("d", "2026-01-01_gone.jsonl", join(base, "gone"), two);
  await mkdir(join(home, ".pi", "agent", "sessions", "empty"));
  const got = initCandidates(proj, 30, home, Date.now(), excl);
  assert.deepEqual(got.map((c) => c.sessionFile).sort(), [main, inWt].sort());
  assert.equal(got.find((c) => c.sessionFile === main)!.users, 3);
  assert.ok(got.every((c) => c.calls >= 1 && c.mtimeMs > 0));
});

const PREAMBLE_TEXT = "You are working inside Orca, a multi-agent IDE. You are a dispatched worker.\nTASK";

function loadCmd(cwd: string, answer = true) {
  const commands: Record<string, any> = {};
  const spawns: string[][] = [];
  const notes: [string, string][] = [];
  const confirms: string[] = [];
  bigBrain({ on: () => {}, registerCommand: (name: string, o: any) => (commands[name] = o) } as any, (a) => spawns.push(a));
  const ctx = {
    cwd,
    sessionManager: { getSessionFile: () => undefined },
    ui: { notify: (m: string, t: string) => notes.push([m, t]), confirm: async (_t: string, m: string) => (confirms.push(m), answer) },
  };
  const cmd = async (args: string) => commands["big-brain-init"].handler(args, ctx);
  return { commands, spawns, notes, confirms, cmd };
}
const stateSessions = (home: string) => readdir(join(home, ".pi", "agent", "wiki-state", "sessions")).catch(() => []);

test("/big-brain-init: bad args give usage and write nothing", async () => {
  const { home, proj, session } = await project();
  await session("a", "s.jsonl", proj, ["a", "b"]);
  for (const a of ["0", "x", "-1", "1.5", "1 2 3"]) {
    const { cmd, notes, spawns } = loadCmd(proj);
    await cmd(a);
    assert.deepEqual(notes, [["Usage: /big-brain-init [N] [days]", "error"]], a);
    assert.deepEqual(spawns, []);
  }
  assert.deepEqual(await stateSessions(home), []);
  assert.equal(existsSync(join(proj, ".pi")), false);
});

test("/big-brain-init: not a repo, nothing to import", async () => {
  const { home, proj } = await project();
  let c = loadCmd(home);
  await c.cmd("");
  assert.deepEqual(c.notes, [["Not in a git repo", "error"]]);
  c = loadCmd(proj);
  await c.cmd("5 7");
  assert.deepEqual(c.notes, [["Nothing to import", "info"]]);
  assert.deepEqual(c.confirms, []);
});

test("/big-brain-init: declined writes nothing", async () => {
  const { home, proj, session } = await project();
  await session("a", "s.jsonl", proj, ["a", "b"]);
  const { cmd, spawns, confirms } = loadCmd(proj, false);
  await cmd("");
  assert.match(confirms[0], /Import 1 sessions \(about 1 updater calls/);
  assert.equal(existsSync(join(proj, ".pi", "wiki")), false);
  assert.deepEqual(await stateSessions(home), []);
  assert.deepEqual(spawns, []);
});

test("/big-brain-init: accepted registers pid 0 records and spawns catch-up once", async () => {
  const { home, proj, wt, session } = await project();
  const f1 = await session("a", "s1.jsonl", proj, ["a", "b"]);
  await session("a", "s2.jsonl", proj, ["a", "b"]);
  await session("a", "s3.jsonl", proj, ["a", "b", "c"]);
  const { cmd, spawns, notes } = loadCmd(wt);
  await cmd("2");
  assert.ok(existsSync(join(proj, ".pi", "wiki")));
  const recs = await stateSessions(home);
  assert.equal(recs.length, 2);
  const r = JSON.parse(await readFile(join(home, ".pi", "agent", "wiki-state", "sessions", recs[0]), "utf8"));
  assert.equal(r.pid, 0);
  assert.equal(r.projectRoot, proj);
  assert.ok(existsSync(regFile(home, join(home, ".pi", "agent", "sessions", "a", "s3.jsonl"))));
  assert.ok(existsSync(regFile(home, f1)) !== existsSync(regFile(home, join(home, ".pi", "agent", "sessions", "a", "s2.jsonl"))));
  assert.deepEqual(spawns, [["--mode", "catchup", "--project", proj]]);
  assert.equal(notes.length, 1);
  assert.match(notes[0][0], /^Importing 2 sessions/);
});

test("/big-brain-init: held lock still registers, notify says next catch-up", async () => {
  const { home, proj, session } = await project();
  await session("a", "s.jsonl", proj, ["a", "b"]);
  const lock = join(home, ".pi", "agent", "wiki-state", "lock");
  await mkdir(join(home, ".pi", "agent", "wiki-state"), { recursive: true });
  const holder = spawn("flock", [lock, "sleep", "5"], { stdio: "ignore" });
  try {
    while (spawnSync("flock", ["-n", lock, "true"]).status === 0) await new Promise((r) => setTimeout(r, 20));
    const { cmd, spawns, notes } = loadCmd(proj);
    await cmd("");
    assert.equal((await stateSessions(home)).length, 1);
    assert.deepEqual(spawns, [["--mode", "catchup", "--project", proj]]);
    assert.match(notes[0][0], /another big-brain run is active/);
  } finally {
    holder.kill();
  }
});

test("PI_BIG_BRAIN=off registers no command", async () => {
  process.env.PI_BIG_BRAIN = "off";
  const commands: Record<string, unknown> = {};
  bigBrain({ on: () => {}, registerCommand: (n: string, o: unknown) => (commands[n] = o) } as any);
  assert.deepEqual(commands, {});
});
