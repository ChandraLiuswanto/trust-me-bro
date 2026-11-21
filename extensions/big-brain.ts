/**
 * big-brain wiki memory: injects the wiki indexes into every session and, for digestible
 * interactive sessions, spawns the background updater (lib/big-brain-run.ts).
 * PI_BIG_BRAIN=off disables it.
 */
import { execFileSync, spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { digestible, globalWiki, injectBlock, isOff, projectWiki, regFile, writeAtomic } from "../lib/big-brain.ts";

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
