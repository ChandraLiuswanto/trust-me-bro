import { appendFile, copyFile, mkdir, open, readdir, readFile, rename, rm, unlink, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { execFile, spawn } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { homedir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs, promisify } from "node:util";
import {
  GLOBAL_TYPES,
  MAX_PAGES,
  MAX_PAGE_LINES,
  areas,
  chunk,
  citation,
  condense,
  globalWiki,
  parseEntries,
  projectWiki,
  sliceAfter,
  stateDir,
  userCount,
  validateWiki,
  writeAtomic,
  type Chunk,
  type Reg,
  type SessState,
  type State,
} from "./big-brain.ts";

export type Deps = {
  home: string;
  runChild: (prompt: string, roots: string[], timeoutMs: number) => Promise<number>; // exit code
  bdMemories: (projectRoot: string) => Promise<string>; // "" if bd absent or no .beads/
  now: () => Date;
  pidAlive: (pid: number) => boolean;
};
export type WikiPair = { staged: string; live: string; hashes: Map<string, string> }; // hashes: live filename -> sha256 at staging time

const CHILD_TIMEOUT = 5 * 60_000;
const MAX_FAILURES = 3;
const exec = promisify(execFile);
const sha = (s: string | Buffer) => createHash("sha256").update(s).digest("hex");
const readOr = (p: string) => readFile(p, "utf8").catch(() => null);

async function mdFiles(dir: string): Promise<string[]> {
  const ents = await readdir(dir, { withFileTypes: true }).catch(() => []);
  return ents.filter((d) => d.isFile() && d.name.endsWith(".md")).map((d) => d.name);
}

async function takeLock(path: string, pidAlive: (pid: number) => boolean): Promise<boolean> {
  for (let i = 0; i < 2; i++) {
    try {
      const fh = await open(path, "wx");
      await fh.writeFile(String(process.pid));
      await fh.close();
      return true;
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e;
    }
    const pid = Number(await readOr(path));
    if (pid > 0 && pidAlive(pid)) return false;
    await unlink(path).catch(() => {});
  }
  return false;
}

async function stage(live: string, staged: string): Promise<Map<string, string>> {
  await mkdir(staged, { recursive: true });
  const hashes = new Map<string, string>();
  for (const f of await mdFiles(live)) {
    hashes.set(f, sha(await readFile(join(live, f))));
    await copyFile(join(live, f), join(staged, f));
  }
  return hashes;
}

// shortcut: if apply fails or the supervisor dies mid-publish, a chunk can be half-published until the next run redoes
// it. Each page stays whole, since every write is a rename. Upgrade to a publish journal if this is ever seen.
export async function preflightAndApply(pairs: WikiPair[]): Promise<"ok" | "conflict"> {
  const plans: { live: string; writes: [string, string][]; deletes: string[] }[] = [];
  for (const { staged, live, hashes } of pairs) {
    const names = await mdFiles(staged);
    const writes: [string, string][] = [];
    const deletes: string[] = [];
    for (const f of names) {
      const next = await readFile(join(staged, f), "utf8");
      const cur = await readOr(join(live, f));
      if (cur === next) continue;
      if ((cur === null ? undefined : sha(cur)) !== hashes.get(f)) return "conflict";
      writes.push([f, next]);
    }
    for (const [f, h] of hashes) {
      if (names.includes(f)) continue;
      const cur = await readOr(join(live, f));
      if (cur === null) continue;
      if (sha(cur) !== h) return "conflict";
      deletes.push(f);
    }
    plans.push({ live, writes, deletes });
  }
  for (const { live, writes, deletes } of plans) {
    for (const [f, text] of writes) {
      const tmp = join(live, `.${f}.${randomBytes(4).toString("hex")}.tmp`);
      await writeFile(tmp, text);
      await rename(tmp, join(live, f));
    }
    for (const f of deletes) await unlink(join(live, f));
  }
  return "ok";
}

function buildPrompt(o: {
  cite: string; global: string; project: string | null; areas: string[];
  globalIndex: string; projectIndex: string; bd: string; chunk: string;
}): string {
  const project = o.project
    ? `Project wiki (staging copy): ${o.project}/
  What the project is, how its parts fit, decisions and why, gotchas spanning several facts.
  Page types: overview.md (what the project is and how its parts fit; at most one), decision-<area>-<topic>.md (a choice made and why), gotcha-<area>-<topic>.md (traps spanning several facts; single facts stay in bd).
  Areas: ${o.areas.join(", ")} (db = schema and migrations, cross = spans apps).`
    : "There is no project wiki for this session. Write only global pages.";
  return `You maintain a memory wiki of notes from Pi coding sessions with Chandra. Below is one chunk of a past session transcript. Update the wiki staging copies so future sessions benefit, using only the read, write and edit tools. Write only directly inside the staging dirs below, never anywhere else.

Global wiki (staging copy): ${o.global}/
  Chandra's preferences and corrections; machine/environment facts; lessons that apply across projects.
  Page types: ${GLOBAL_TYPES.map((t) => `${t}-<slug>.md`).join(", ")} (preference = how Chandra wants things done, environment = this machine and its tools, lesson = techniques and gotchas that apply across projects).
${project}

Rules:
- The default is to write nothing. Keep only what a future session would want, and that isn't already in APPEND_SYSTEM.md, AGENTS.md, CLAUDE.md, bd, or the repo's own docs (README.md, docs/, a hand-written wiki/). You may read those but never write there; link to them instead of copying.
- Rewrite pages; don't just append. Merge duplicates. When a newer session contradicts a fact, replace it and keep the newer citation. To delete a page, overwrite it with empty content.
- Every fact line ends with this session's citation: ${o.cite}
- Caps: about ${MAX_PAGE_LINES} lines per page, ${MAX_PAGES} pages per wiki, index entries one line each.
- Never write secrets: keys, tokens, passwords, auth URLs, private user data.
- Name every page <type>-<slug>.md (lowercase a-z, 0-9, -) using that wiki's types. Project decision/gotcha slugs start with an area. Put a fact on the page of the type it belongs to. No subdirectories, no other files.
- Keep each wiki's index.md in sync with its pages. Each line is "- [name](name.md): <the concrete topics on the page>", with relative links, e.g. "commit messages, reply length, review habits", not "preferences".

Current global index.md:
${o.globalIndex.trim() || "(empty)"}

Current project index.md:
${o.projectIndex.trim() || "(empty)"}

bd memories (atomic project facts; mention or link, never copy):
${o.bd.trim() || "(none)"}

<transcript>
${o.chunk}
</transcript>`;
}

async function runChunk(deps: Deps, sd: string, reg: Reg, cite: string, c: Chunk): Promise<void> {
  const run = join(sd, "runs", randomBytes(6).toString("hex"));
  try {
    const gLive = globalWiki(deps.home);
    const pLive = reg.projectRoot && existsSync(projectWiki(reg.projectRoot)) ? projectWiki(reg.projectRoot) : null;
    const pairs: WikiPair[] = [{ staged: join(run, "global"), live: gLive, hashes: await stage(gLive, join(run, "global")) }];
    if (pLive) pairs.push({ staged: join(run, "project"), live: pLive, hashes: await stage(pLive, join(run, "project")) });
    const A = reg.projectRoot ? areas(reg.projectRoot) : [];
    const prompt = buildPrompt({
      cite,
      global: pairs[0].staged,
      project: pLive && pairs[1].staged,
      areas: A,
      globalIndex: (await readOr(join(gLive, "index.md"))) ?? "",
      projectIndex: (pLive && (await readOr(join(pLive, "index.md")))) ?? "",
      bd: pLive && reg.projectRoot ? await deps.bdMemories(reg.projectRoot) : "",
      chunk: c.text,
    });
    const code = await deps.runChild(prompt, pairs.map((p) => p.staged), CHILD_TIMEOUT);
    if (code !== 0) throw new Error(`child exited ${code}`);
    // the child has no delete tool; an emptied page means "remove it"
    for (const p of pairs)
      for (const f of await mdFiles(p.staged))
        if (!(await readFile(join(p.staged, f), "utf8")).trim()) await unlink(join(p.staged, f));
    for (const [i, p] of pairs.entries()) {
      const err = validateWiki(p.staged, i === 0 ? "global" : "project", A);
      if (err) throw new Error(`validation: ${err}`);
    }
    if ((await preflightAndApply(pairs)) === "conflict") throw new Error("conflict: live wiki edited during run");
    await exec("git", ["add", "-A", "--", "."], { cwd: gLive });
    const staged = await exec("git", ["diff", "--cached", "--quiet"], { cwd: gLive }).then(() => false, (e) => {
      if (e.code === 1) return true;
      throw e;
    });
    if (staged)
      await exec("git", ["-c", "user.name=big-brain", "-c", "user.email=big-brain@localhost", "commit", "-q", "-m", `big brain: ${cite}`], { cwd: gLive });
  } finally {
    await rm(run, { recursive: true, force: true });
  }
}

async function digest(deps: Deps, sd: string, reg: Reg, final: boolean, save: (s: SessState) => Promise<void>, s: SessState) {
  const entries = parseEntries((await readOr(reg.sessionFile)) ?? "");
  if (!entries.length) return;
  const end = entries[entries.length - 1].id;
  const head = entries.find((e) => e.type === "session");
  const cite = citation(reg.sessionFile, head?.id ?? end, head?.timestamp ?? deps.now().toISOString());
  const slice = sliceAfter(entries, s.marker, end);
  if (userCount(slice) < 2) {
    if (final) await save({ ...s, marker: end, status: "done" });
    return;
  }
  for (const c of chunk(condense(slice), end)) {
    try {
      await runChunk(deps, sd, reg, cite, c);
      s = { ...s, marker: c.lastId };
      await save(s);
    } catch (e) {
      const failures = s.failures + 1;
      await appendFile(join(sd, "log"), `${deps.now().toISOString()} ${reg.sessionFile} ${(e as Error).message}\n`);
      await save({ ...s, failures, status: failures >= MAX_FAILURES ? "skipped" : s.status });
      return;
    }
  }
  if (final) await save({ ...s, marker: end, status: "done" });
}

export async function main(argv: string[], deps: Deps): Promise<void> {
  const { values: a } = parseArgs({
    args: argv,
    options: { mode: { type: "string" }, session: { type: "string" }, final: { type: "boolean" }, project: { type: "string" } },
  });
  const sd = stateDir(deps.home);
  await mkdir(sd, { recursive: true });
  const lock = join(sd, "lock");
  if (!(await takeLock(lock, deps.pidAlive))) return;
  try {
    const gw = globalWiki(deps.home);
    if (!existsSync(join(gw, ".git"))) {
      await mkdir(gw, { recursive: true });
      await exec("git", ["init", "-q"], { cwd: gw });
    }
    const regs: Reg[] = [];
    for (const f of await readdir(join(sd, "sessions")).catch(() => [] as string[])) {
      try {
        regs.push(JSON.parse((await readFile(join(sd, "sessions", f), "utf8"))));
      } catch {
        // skip unreadable record
      }
    }
    const statePath = join(sd, "state.json");
    const loadState = async (): Promise<State> => JSON.parse((await readOr(statePath)) || "{}");
    const state = await loadState().catch(() => ({}) as State);
    const get = (f: string): SessState => state[f] ?? { marker: null, failures: 0, status: "active" };
    const picked =
      a.mode === "session"
        ? regs.filter((r) => r.sessionFile === a.session && get(r.sessionFile).status !== "skipped")
        : regs.filter((r) =>
            r.projectRoot === (a.project ?? null) && !deps.pidAlive(r.pid) && !["done", "skipped"].includes(get(r.sessionFile).status));
    for (const reg of picked) {
      const save = async (s: SessState) => {
        const cur = await loadState().catch(() => ({}) as State);
        cur[reg.sessionFile] = s;
        await writeAtomic(statePath, JSON.stringify(cur, null, 2));
      };
      await digest(deps, sd, reg, a.mode === "session" && !!a.final, save, get(reg.sessionFile));
    }
  } finally {
    await unlink(lock).catch(() => {});
  }
}

async function model(home: string): Promise<string> {
  try {
    return JSON.parse(await readFile(join(home, ".pi", "agent", "settings.json"), "utf8")).bigBrain?.model || "fedora/memory-generate";
  } catch {
    return "fedora/memory-generate";
  }
}

const realDeps: Deps = {
  home: homedir(),
  async runChild(prompt, roots, timeoutMs) {
    const guard = fileURLToPath(new URL("./big-brain-guard.ts", import.meta.url));
    const args = ["-p", "--no-session", "--no-extensions", "-e", guard, "--model", await model(homedir()), "--tools", "read,write,edit", prompt];
    const child = spawn("pi", args, { env: { ...process.env, PI_BIG_BRAIN: "off", BIG_BRAIN_ROOTS: roots.join(":") }, stdio: "ignore" });
    const timer = setTimeout(() => child.kill("SIGKILL"), timeoutMs);
    return new Promise((resolve) => {
      child.on("error", () => resolve(127));
      child.on("close", (code) => {
        clearTimeout(timer);
        resolve(code ?? 1);
      });
    });
  },
  async bdMemories(root) {
    if (!existsSync(join(root, ".beads"))) return "";
    return exec("bd", ["memories"], { cwd: root }).then((r) => r.stdout, () => "");
  },
  now: () => new Date(),
  pidAlive(pid) {
    try {
      process.kill(pid, 0);
      return true;
    } catch (e) {
      return (e as NodeJS.ErrnoException).code === "EPERM";
    }
  },
};

if (import.meta.main) {
  main(process.argv.slice(2), realDeps).catch((e) =>
    appendFile(join(stateDir(), "log"), `${new Date().toISOString()} supervisor ${(e as Error).message}\n`).catch(() => {}));
}
