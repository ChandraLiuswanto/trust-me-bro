import { test, after } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdtemp, mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { INDEX_CAP, globalWiki, projectWiki, regFile, stateDir, writeAtomic, type State } from "../lib/big-brain.ts";
import { main, pidAlive, preflightAndApply, type Deps } from "../lib/big-brain-run.ts";

const dir = await mkdtemp(join(tmpdir(), "big-brain-run-"));
after(() => rm(dir, { recursive: true, force: true }));

const DEAD = 999_999_999;
const RUNNER = fileURLToPath(new URL("../lib/big-brain-run.ts", import.meta.url));
let n = 0;
type Child = (prompt: string, roots: string[]) => Promise<number> | number;

async function setup(o: { users?: number; text?: string; wiki?: boolean; pid?: number } = {}) {
  const home = join(dir, `h${n++}`);
  const root = join(home, "repo");
  await mkdir(join(root, "frontend"), { recursive: true });
  if (o.wiki !== false) await mkdir(projectWiki(root), { recursive: true });
  const sessionFile = join(home, "s.jsonl");
  const lines: object[] = [{ type: "session", id: "abcdef12-3456", timestamp: "2026-11-21T14:38:13.130Z" }];
  for (let i = 0; i < (o.users ?? 2); i++) {
    lines.push({ type: "message", id: `u${i}`, message: { role: "user", content: o.text ?? `msg ${i}` } });
    lines.push({ type: "message", id: `a${i}`, message: { role: "assistant", content: [{ type: "text", text: "ok" }] } });
  }
  await writeFile(sessionFile, lines.map((l) => JSON.stringify(l)).join("\n") + "\n");
  await writeAtomic(regFile(home, sessionFile), JSON.stringify({ sessionFile, projectRoot: root, pid: o.pid ?? DEAD }));
  const calls: { prompt: string; roots: string[] }[] = [];
  const deps = (child: Child = () => 0): Deps => ({
    home,
    runChild: async (prompt, roots) => {
      calls.push({ prompt, roots });
      return child(prompt, roots);
    },
    bdMemories: async () => "",
    now: () => new Date("2026-11-21T15:00:00Z"),
    pidAlive: (pid) => pid !== DEAD,
  });
  const gw = globalWiki(home);
  const pw = projectWiki(root);
  return {
    home, root, sessionFile, calls, deps, gw, pw,
    run: (child?: Child, ...args: string[]) =>
      main(args.length ? args : ["--mode", "session", "--session", sessionFile, "--project", root], deps(child)),
    state: async (): Promise<State> => JSON.parse(await readFile(join(stateDir(home), "state.json"), "utf8").catch(() => "{}")),
    commits: () => {
      try {
        return execFileSync("git", ["log", "--format=%s"], { cwd: gw, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim().split("\n").filter(Boolean);
      } catch {
        return [];
      }
    },
    snapshot: async () => {
      const out: Record<string, string> = {};
      for (const d of [gw, pw])
        for (const f of await readdir(d, { recursive: true }).catch(() => [] as string[]))
          if (!f.startsWith(".git") && f.endsWith(".md")) out[join(d, f)] = await readFile(join(d, f), "utf8");
      return out;
    },
  };
}

const writePages = (g: Record<string, string>, p: Record<string, string> = {}): Child => async (_, roots) => {
  for (const [r, files] of [[roots[0], g], [roots[1], p]] as const)
    for (const [f, t] of Object.entries(files)) {
      await mkdir(dirname(join(r, f)), { recursive: true });
      await writeFile(join(r, f), t);
    }
  return 0;
};
const G = { "index.md": "### lesson\n- [lesson/a](lesson/a.md): a\n", "lesson/a.md": "fact [s:2026-11-21 abcdef]\n" };
const P = { "index.md": "### gotcha\n- [gotcha/db-x](gotcha/db-x.md): what\n", "gotcha/db-x.md": "x [s:2026-11-21 abcdef]\n" };

test("happy path publishes and commits once", async () => {
  const t = await setup();
  await t.run(writePages(G, P));
  assert.equal(await readFile(join(t.gw, "lesson/a.md"), "utf8"), G["lesson/a.md"]);
  assert.ok(existsSync(join(t.pw, "gotcha/db-x.md")), "type dir created in live");
  assert.deepEqual(t.commits(), ["big brain: [s:2026-11-21 abcdef]"]);
  assert.match(t.calls[0].prompt, /\[s:2026-11-21 abcdef\]/);
  assert.match(t.calls[0].prompt, /frontend/);
  assert.match(t.calls[0].prompt, /USER: msg 0/);
  assert.equal((await t.state())[t.sessionFile].marker, "a1");
  assert.equal((await t.state())[t.sessionFile].status, "active");
  assert.deepEqual(await readdir(join(stateDir(t.home), "runs")), []);
});

test("prompt: no-history rule, folder types, index cap and size", async () => {
  const t = await setup();
  await writeFile(join(t.pw, "index.md"), "");
  await t.run(writePages(G, P));
  const p = t.calls[0].prompt;
  assert.ok(p.includes("- Don't record session history: no worktree paths, branch names, commit hashes, test counts, merge/push/deploy status or review/approval narration, or what a plan, spec or review said or required.\n- Rewrite pages"));
  assert.ok(p.includes("- Don't restate a spec or plan; if the repo's docs cover it, write nothing.\n"));
  assert.match(p, /MUST start with one of these areas: [^\n]*frontend[^\n]*gotcha\/backend-formula-injection\.md[^\n]*gotcha\/formula-injection\.md: no area[^\n]*whole update is thrown away/);
  for (const w of ["decision", "fact", "gotcha", `${INDEX_CAP} bytes`, "current size: global 0 bytes, project 0 bytes", "docs/superpowers/specs/"]) assert.ok(p.includes(w), w);
  for (const w of ["overview.md", "pages per wiki", "MAX_PAGES"]) assert.ok(!p.includes(w), w);
});

test("fresh empty global wiki, child writes nothing → no commit, marker advanced", async () => {
  const t = await setup();
  await t.run();
  assert.ok(existsSync(join(t.gw, ".git")));
  assert.deepEqual(t.commits(), []);
  assert.equal((await t.state())[t.sessionFile].marker, "a1");
  assert.ok(!existsSync(join(stateDir(t.home), "log")));
});

test("global commit holds only the pages the run changed", async () => {
  const t = await setup();
  await mkdir(t.gw, { recursive: true });
  execFileSync("git", ["init", "-q"], { cwd: t.gw });
  const g = (...a: string[]) => execFileSync("git", ["-c", "user.name=u", "-c", "user.email=u@x", ...a], { cwd: t.gw, encoding: "utf8" });
  await mkdir(join(t.gw, "lesson"));
  await writeFile(join(t.gw, "lesson/b.md"), "b\n");
  g("add", "lesson/b.md");
  g("commit", "-q", "-m", "init");
  await writeFile(join(t.gw, "secret.txt"), "sk-ant-abcdefghijklmnopqrstu");
  await writeFile(join(t.gw, "lesson/b.md"), "user edit\n");
  g("add", "lesson/b.md");
  await t.run(writePages({ "index.md": "### lesson\n- [lesson/a](lesson/a.md): a\n- [lesson/b](lesson/b.md): b\n", "lesson/a.md": "fact\n" }));
  assert.deepEqual(g("show", "--name-only", "--format=", "HEAD").trim().split("\n").sort(), ["index.md", "lesson/a.md"]);
  assert.equal(g("diff", "--cached", "--name-only").trim(), "lesson/b.md");
  assert.match(g("status", "--porcelain"), /\?\? secret.txt/);
});

test("final digest → done", async () => {
  const t = await setup();
  await t.run(undefined, "--mode", "session", "--session", t.sessionFile, "--project", t.root, "--final");
  assert.deepEqual((await t.state())[t.sessionFile], { marker: "a1", failures: 0, status: "done" });
});

test("project-only change → no global commit, project uncommitted", async () => {
  const t = await setup();
  await t.run(writePages({}, P));
  assert.ok(existsSync(join(t.pw, "gotcha/db-x.md")));
  assert.deepEqual(t.commits(), []);
});

test("child non-zero → live byte-identical, failures=1", async () => {
  const t = await setup();
  await t.run(writePages(G));
  const before = await t.snapshot();
  await writeFile(t.sessionFile, (await readFile(t.sessionFile, "utf8")) + [
    { type: "message", id: "u9", message: { role: "user", content: "x" } },
    { type: "message", id: "u10", message: { role: "user", content: "y" } },
  ].map((l) => JSON.stringify(l)).join("\n") + "\n");
  await t.run(async (p, roots) => {
    await writePages({ "lesson/a.md": "changed\n" })(p, roots);
    return 1;
  });
  assert.deepEqual(await t.snapshot(), before);
  assert.equal((await t.state())[t.sessionFile].failures, 1);
  assert.equal((await t.state())[t.sessionFile].marker, "a1");
  assert.match(await readFile(join(stateDir(t.home), "log"), "utf8"), /child exited 1/);
});

test("validation failure and secret leave live unchanged", async () => {
  for (const bad of [{ "notes/x.md": "x" }, { "lesson/a.md": "key sk-ant-abcdefghijklmnopqrstu" }, { "lesson/b.md": "unlisted" }]) {
    const t = await setup();
    await t.run(writePages({ ...G, ...bad }));
    assert.deepEqual(await t.snapshot(), {});
    assert.equal((await t.state())[t.sessionFile].failures, 1);
    assert.equal((await t.state())[t.sessionFile].marker, null);
  }
});

test("hash conflict: live page edited during run → nothing published", async () => {
  const t = await setup();
  await mkdir(join(t.pw, "gotcha"));
  await writeFile(join(t.pw, "gotcha/db-x.md"), "orig\n");
  await writeFile(join(t.pw, "index.md"), P["index.md"]);
  await t.run(async (p, roots) => {
    await writeFile(join(t.pw, "gotcha/db-x.md"), "hand edit\n");
    return writePages(G, { "gotcha/db-x.md": "child\n" })(p, roots);
  });
  assert.equal(await readFile(join(t.pw, "gotcha/db-x.md"), "utf8"), "hand edit\n");
  assert.ok(!existsSync(join(t.gw, "lesson/a.md")), "nested conflict publishes nothing in either wiki");
  assert.deepEqual(t.commits(), []);
  assert.match(await readFile(join(stateDir(t.home), "log"), "utf8"), /conflict/);
});

test("project conflict with a global change → neither wiki written", async () => {
  const t = await setup();
  await mkdir(join(t.pw, "fact"));
  await writeFile(join(t.pw, "fact/db-y.md"), "orig\n");
  await writeFile(join(t.pw, "index.md"), "### fact\n- [fact/db-y](fact/db-y.md): y\n");
  await t.run(async (p, roots) => {
    await writeFile(join(t.pw, "fact/db-y.md"), "hand\n");
    return writePages(G, { "fact/db-y.md": "child\n" })(p, roots);
  });
  assert.ok(!existsSync(join(t.gw, "lesson/a.md")));
  assert.deepEqual(t.commits(), []);
});

test("retry after a partial apply succeeds; preflight conflicts write nothing", async () => {
  const d = join(dir, `pa${n++}`);
  const [live, staged, live2, staged2] = ["live", "staged", "live2", "staged2"].map((x) => join(d, x));
  for (const x of [live, staged, live2, staged2]) await mkdir(join(x, "t"), { recursive: true });
  const sha = (s: string) => createHash("sha256").update(s).digest("hex");
  await writeFile(join(live, "t/a.md"), "old a");
  await writeFile(join(live, "t/b.md"), "old b");
  const hashes = new Map([["t/a.md", sha("old a")], ["t/b.md", sha("old b")]]);
  await writeFile(join(staged, "t/a.md"), "new a");
  await writeFile(join(staged, "t/b.md"), "new b");
  // first attempt died after a.md was renamed in
  await writeFile(join(live, "t/a.md"), "new a");
  assert.deepEqual(await preflightAndApply([{ staged, live, hashes }]), [["t/b.md"]]);
  assert.equal(await readFile(join(live, "t/b.md"), "utf8"), "new b");
  assert.deepEqual((await readdir(join(live, "t"))).sort(), ["a.md", "b.md"], "no tmp file left in the type dir");
  // a hand edit in the second pair blocks the first pair too
  await writeFile(join(staged, "t/a.md"), "newer a");
  await writeFile(join(live2, "t/c.md"), "hand");
  await writeFile(join(staged2, "t/c.md"), "child");
  const h1 = new Map([["t/a.md", sha("new a")], ["t/b.md", sha("new b")]]);
  assert.equal(await preflightAndApply([{ staged, live, hashes: h1 }, { staged: staged2, live: live2, hashes: new Map([["t/c.md", sha("orig")]]) }]), "conflict");
  assert.equal(await readFile(join(live, "t/a.md"), "utf8"), "new a");
});

test("deletion via emptied page, and deletion conflict", async () => {
  const t = await setup();
  await t.run(writePages(G));
  await writeFile(t.sessionFile, (await readFile(t.sessionFile, "utf8")) + ["u8", "u9"].map((id) =>
    JSON.stringify({ type: "message", id, message: { role: "user", content: id } })).join("\n") + "\n");
  await t.run(writePages({ "index.md": "", "lesson/a.md": "" }));
  assert.ok(!existsSync(join(t.gw, "lesson/a.md")));
  assert.ok(!existsSync(join(t.gw, "lesson")), "empty type dir removed");
  assert.deepEqual(t.commits().length, 2);
});

test("three chunks, chunk 2 fails → marker at chunk 1, next run sends 2 and 3", async () => {
  const big = "x".repeat(40 * 1024);
  const t = await setup({ users: 3, text: big });
  let k = 0;
  await t.run(() => (++k === 2 ? 1 : 0));
  assert.equal(t.calls.length, 2);
  const marker = (await t.state())[t.sessionFile].marker;
  assert.equal(marker, "a0");
  t.calls.length = 0;
  await t.run();
  assert.equal(t.calls.length, 2);
  assert.match(t.calls[0].prompt, /USER: x/);
  assert.equal((await t.state())[t.sessionFile].marker, "a2");
});

// real CLI under a temp HOME; a fake `pi` exits 0 so an unlocked run digests without a model
async function cli(t: { home: string; sessionFile: string; root: string }) {
  const bin = join(t.home, "bin");
  await mkdir(bin, { recursive: true });
  await writeFile(join(bin, "pi"), "#!/bin/sh\nexit 0\n", { mode: 0o755 });
  const env = { ...process.env, NODE_NO_WARNINGS: "1", HOME: t.home, PATH: `${bin}:${process.env.PATH}` };
  delete env.BIG_BRAIN_LOCKED;
  return spawnSync(process.execPath, [RUNNER, "--mode", "session", "--session", t.sessionFile, "--project", t.root], { env, encoding: "utf8" });
}

test("CLI: locked supervisor does not leak the lock marker to children", async () => {
  const t = await setup();
  const bin = join(t.home, "bin");
  await mkdir(bin, { recursive: true });
  await writeFile(join(bin, "git"), '#!/bin/sh\nprintf "%s" "${BIG_BRAIN_LOCKED-}" > "$HOME/child-lock-marker"\n', { mode: 0o755 });
  const r = await cli(t);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(await readFile(join(t.home, "child-lock-marker"), "utf8"), "");
});

// one process holds the flock fd (exec keeps it), so SIGKILL on that pid frees it
async function holdLock(home: string) {
  await mkdir(stateDir(home), { recursive: true });
  const h = spawn("sh", ["-c", 'exec 9>>"$1"; flock -n 9 || exit 1; echo ready; exec sleep 30', "sh", join(stateDir(home), "lock")]);
  await new Promise((ok, no) => { h.stdout.once("data", ok); h.once("exit", no); });
  return h;
}

test("CLI: lock held by another process → no work, quiet exit", async () => {
  const t = await setup();
  const h = await holdLock(t.home);
  try {
    const r = await cli(t);
    assert.equal(r.status, 75);
    assert.equal(r.stdout + r.stderr, "");
    assert.deepEqual(await t.state(), {});
    assert.ok(!existsSync(join(stateDir(t.home), "log")));
  } finally {
    h.kill("SIGKILL");
  }
});

test("CLI: SIGKILLed holder frees the lock; next run proceeds and the lock file stays", async () => {
  const t = await setup();
  const h = await holdLock(t.home);
  h.kill("SIGKILL");
  await new Promise((ok) => h.once("exit", ok));
  const r = await cli(t);
  assert.equal(r.status, 0, r.stderr);
  assert.equal((await t.state())[t.sessionFile].marker, "a1");
  assert.ok(existsSync(join(stateDir(t.home), "lock")));
});

test("catch-up skips live pid, unregistered, done and skipped sessions", async () => {
  const t = await setup({ pid: process.pid });
  const catchup = (child?: Child) => t.run(child, "--mode", "catchup", "--project", t.root);
  await catchup();
  assert.equal(t.calls.length, 0, "live pid");
  for (const [name, status] of [["done", "done"], ["skipped", "skipped"], ["active", "active"]] as const) {
    const f = join(t.home, `${name}.jsonl`);
    await writeFile(f, await readFile(t.sessionFile, "utf8"));
    await writeAtomic(regFile(t.home, f), JSON.stringify({ sessionFile: f, projectRoot: t.root, pid: DEAD }));
    const st = await t.state();
    st[f] = { marker: null, failures: 0, status };
    await writeAtomic(join(stateDir(t.home), "state.json"), JSON.stringify(st));
  }
  await writeFile(join(t.home, "unregistered.jsonl"), await readFile(t.sessionFile, "utf8"));
  await catchup();
  assert.equal(t.calls.length, 1);
  assert.ok(t.calls[0].roots.length === 2);
  assert.equal((await t.state())[join(t.home, "active.jsonl")].marker, "a1");
  // a different project is not caught up
  t.calls.length = 0;
  await t.run(undefined, "--mode", "catchup", "--project", "/elsewhere");
  assert.equal(t.calls.length, 0);
});

test("1-user-message slice waits; on final the marker moves and status is done", async () => {
  const t = await setup({ users: 1 });
  await t.run();
  assert.equal(t.calls.length, 0);
  assert.equal((await t.state())[t.sessionFile], undefined);
  await t.run(undefined, "--mode", "session", "--session", t.sessionFile, "--project", t.root, "--final");
  assert.equal(t.calls.length, 0);
  assert.deepEqual((await t.state())[t.sessionFile], { marker: "a0", failures: 0, status: "done" });
});

test("2-message slice split across chunks is digested", async () => {
  const t = await setup({ users: 2, text: "y".repeat(50 * 1024) });
  await t.run();
  assert.equal(t.calls.length, 2);
  assert.equal((await t.state())[t.sessionFile].marker, "a1");
});

test("remainder of a partly digested slice is digested even under 2 users", async () => {
  const t = await setup({ users: 2, text: "y".repeat(50 * 1024) });
  let k = 0;
  await t.run(() => (++k === 2 ? 1 : 0));
  assert.equal((await t.state())[t.sessionFile].marker, "a0");
  t.calls.length = 0;
  await t.run(undefined, "--mode", "session", "--session", t.sessionFile, "--project", t.root, "--final");
  assert.equal(t.calls.length, 1);
  assert.match(t.calls[0].prompt, /USER: y/);
  assert.deepEqual((await t.state())[t.sessionFile], { marker: "a1", failures: 0, status: "done" });
});

test("3 failures → skipped", async () => {
  const t = await setup();
  for (let i = 0; i < 4; i++) await t.run(() => 1);
  assert.equal(t.calls.length, 3);
  assert.deepEqual((await t.state())[t.sessionFile], { marker: null, failures: 3, status: "skipped" });
});

test("project wiki not created when .pi/wiki is absent; global still updates", async () => {
  const t = await setup({ wiki: false });
  await t.run(writePages(G));
  assert.equal(t.calls[0].roots.length, 1);
  assert.match(t.calls[0].prompt, /no project wiki/);
  assert.ok(!existsSync(t.pw));
  assert.ok(existsSync(join(t.gw, "lesson/a.md")));
  assert.equal(t.commits().length, 1);
});

test("pidAlive: pid <= 0 is dead", () => {
  assert.equal(pidAlive(0), false);
  assert.equal(pidAlive(-1), false);
  assert.equal(pidAlive(process.pid), true);
});

test("catch-up digests oldest first and picks pid 0 with the real pidAlive", async () => {
  const t = await setup();
  const base = await readFile(t.sessionFile, "utf8");
  for (const name of ["2026-01-02T00-00-00_b.jsonl", "2026-01-01T00-00-00_a.jsonl"]) {
    const f = join(t.home, name);
    await writeFile(f, base.replaceAll("msg ", `${name} `));
    await writeAtomic(regFile(t.home, f), JSON.stringify({ sessionFile: f, projectRoot: t.root, pid: 0 }));
  }
  await main(["--mode", "catchup", "--project", t.root], { ...t.deps(), pidAlive });
  const order = t.calls.map((c) => /2026-01-0\dT\S+_[ab]/.exec(c.prompt)?.[0]).filter(Boolean);
  assert.deepEqual(order.slice(0, 2), ["2026-01-01T00-00-00_a", "2026-01-02T00-00-00_b"]);
});
