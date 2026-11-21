/**
 * big-brain wiki memory: injects the wiki indexes into every session and, for digestible
 * interactive sessions, spawns the background updater (lib/big-brain-run.ts).
 * PI_BIG_BRAIN=off disables it.
 */
import { execFileSync, spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import {
  chunk,
  condense,
  digestible,
  globalWiki,
  injectBlock,
  isOff,
  parseEntries,
  projectWiki,
  rankInit,
  regFile,
  stateDir,
  userCount,
  workerPrompt,
  writeAtomic,
  type Candidate,
} from "../lib/big-brain.ts";

const RUNNER = fileURLToPath(new URL("../lib/big-brain-run.ts", import.meta.url));

export function mainCheckout(cwd: string): string | null {
  try {
    const out = execFileSync("git", ["-C", cwd, "worktree", "list", "--porcelain"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
    return out.match(/^worktree (.+)$/m)?.[1] ?? null;
  } catch {
    return null;
  }
}

export function initCandidates(projectRoot: string, days: number, home: string, now: number, exclude: string | undefined): Candidate[] {
  const roots = execFileSync("git", ["-C", projectRoot, "worktree", "list", "--porcelain"], { encoding: "utf8" })
    .split("\n\n")
    .map((b) => ({ path: b.match(/^worktree (.+)$/m)?.[1], live: !/^prunable/m.test(b) }))
    // main checkout (first block) always counts; linked worktrees only while live
    .filter((w, i): w is { path: string; live: boolean } => !!w.path && (i === 0 || (w.live && existsSync(w.path))))
    .map((w) => w.path);
  const inProject = (cwd: unknown) => typeof cwd === "string" && roots.some((r) => cwd === r || cwd.startsWith(r + "/"));
  const sessions = join(home, ".pi", "agent", "sessions");
  const out: Candidate[] = [];
  let dirs: string[] = [];
  try {
    dirs = readdirSync(sessions);
  } catch {}
  for (const d of dirs) {
    try {
      const files = readdirSync(join(sessions, d)).filter((f) => f.endsWith(".jsonl")).sort().map((f) => join(sessions, d, f));
      if (!files.length || !inProject(JSON.parse(readFileSync(files[0], "utf8").split("\n")[0]).cwd)) continue;
      for (const sessionFile of files) {
        try {
          const { mtimeMs } = statSync(sessionFile);
          if (mtimeMs < now - days * 864e5 || sessionFile === exclude || existsSync(regFile(home, sessionFile))) continue;
          const entries = parseEntries(readFileSync(sessionFile, "utf8"));
          const first = condense(entries.filter((e) => e.message?.role === "user").slice(0, 1))[0]?.text.slice("USER: ".length) ?? "";
          const users = userCount(entries);
          if (workerPrompt(first) || users < 2) continue;
          out.push({ sessionFile, users, mtimeMs, calls: chunk(condense(entries), entries.at(-1)!.id).length });
        } catch {}
      }
    } catch {}
  }
  return out;
}

export function spawnSupervisor(args: string[]): void {
  spawn(process.execPath, [RUNNER, ...args], { detached: true, stdio: "ignore" }).unref();
}

function readIndex(dir: string): string | null {
  try {
    return readFileSync(join(dir, "index.md"), "utf8");
  } catch {
    return null;
  }
}

export default function (pi: ExtensionAPI, run: (args: string[]) => void = spawnSupervisor) {
  if (isOff()) return;

  pi.registerCommand("big-brain-init", {
    description: "Import past sessions of this project into the memory wikis: /big-brain-init [N=20] [days=30]",
    handler: async (args, ctx) => {
      try {
        const a = args.trim().split(/\s+/).filter(Boolean);
        if (a.length > 2 || a.some((x) => !/^[1-9]\d*$/.test(x))) return ctx.ui.notify("Usage: /big-brain-init [N] [days]", "error");
        const [n = 20, days = 30] = a.map(Number);
        const root = mainCheckout(ctx.cwd);
        if (!root) return ctx.ui.notify("Not in a git repo", "error");
        const picks = rankInit(initCandidates(root, days, homedir(), Date.now(), ctx.sessionManager.getSessionFile()), n);
        if (!picks.length) return ctx.ui.notify("Nothing to import", "info");
        const calls = picks.reduce((s, p) => s + p.calls, 0);
        const msg = `Import ${picks.length} sessions (about ${calls} updater calls, in the background) into ${projectWiki(root)} and the global wiki?`;
        if (!(await ctx.ui.confirm("Import past sessions?", msg))) return;
        mkdirSync(projectWiki(root), { recursive: true });
        for (const { sessionFile } of picks)
          await writeAtomic(regFile(homedir(), sessionFile), JSON.stringify({ sessionFile, projectRoot: root, pid: 0 }));
        const free = spawnSync("flock", ["-n", join(stateDir(), "lock"), "true"]).status === 0;
        run(["--mode", "catchup", "--project", root]);
        ctx.ui.notify(
          free
            ? `Importing ${picks.length} sessions in the background. Watch: git -C ~/.pi/agent/wiki log, ${projectWiki(root)}, ~/.pi/agent/wiki-state/log`
            : `${picks.length} sessions registered; another big-brain run is active, so they will be digested at the next catch-up in this project.`,
          "info",
        );
      } catch (e) {
        ctx.ui.notify(String(e), "error");
      }
    },
  });
  let root: string | null = null;
  let block = "";
  let started = false;
  let file: string | undefined;
  const project = () => (root ? ["--project", root] : []);

  pi.on("session_start", async (_event, ctx) => {
    try {
      root = mainCheckout(ctx.cwd);
      started = false;
      file = undefined;
      const pDir = root && existsSync(projectWiki(root)) ? projectWiki(root) : null;
      block = injectBlock(readIndex(globalWiki()), pDir && readIndex(pDir), globalWiki(), pDir);
    } catch {}
  });

  pi.on("before_agent_start", async (event, ctx) => {
    try {
      if (!started) {
        started = true;
        const sessionFile = ctx.sessionManager.getSessionFile();
        if (sessionFile && digestible(process.env, ctx.hasUI, event.prompt ?? "")) {
          await writeAtomic(regFile(homedir(), sessionFile), JSON.stringify({ sessionFile, projectRoot: root, pid: process.pid }));
          file = sessionFile;
          run(["--mode", "catchup", ...project()]);
        }
      }
      if (block) (event.systemPromptOptions.sections ??= {})["memory-wiki"] = block;
    } catch {}
  });

  const digest = (final: boolean) => {
    try {
      if (file) run(["--mode", "session", "--session", file, ...project(), ...(final ? ["--final"] : [])]);
    } catch {}
  };
  pi.on("session_compact", async () => digest(false));
  pi.on("session_shutdown", async (event) => digest(["quit", "new", "resume", "fork"].includes(event.reason)));
}
