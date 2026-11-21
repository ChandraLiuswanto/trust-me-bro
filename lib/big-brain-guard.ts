/**
 * Loaded only into the big-brain updater child (via -e): write/edit may only touch pages
 * directly inside the staging dirs in BIG_BRAIN_ROOTS (colon-separated).
 */
import { existsSync, lstatSync, realpathSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

function realParent(path: string): string {
  let dir = dirname(path);
  let rest = "";
  while (!existsSync(dir) && dirname(dir) !== dir) {
    rest = rest ? join(basename(dir), rest) : basename(dir);
    dir = dirname(dir);
  }
  return rest ? join(realpathSync(dir), rest) : realpathSync(dir);
}

export function allowedTarget(target: string, cwd: string, roots: string[]): boolean {
  if (!target || target.split(/[\\/]/).includes("..")) return false;
  const abs = resolve(cwd, target);
  if (basename(abs).startsWith(".")) return false;
  try {
    return roots.includes(realParent(abs)) && !isLink(abs);
  } catch {
    return false;
  }
}

function isLink(path: string): boolean {
  try {
    return lstatSync(path).isSymbolicLink();
  } catch {
    return false;
  }
}

export default function (pi: ExtensionAPI) {
  const roots = (process.env.BIG_BRAIN_ROOTS ?? "")
    .split(":")
    .filter(Boolean)
    .flatMap((r) => {
      try {
        return [realpathSync(r)];
      } catch {
        return [];
      }
    });
  pi.on("tool_call", (event, ctx) => {
    if (event.toolName !== "write" && event.toolName !== "edit") return;
    const path = (event.input as { path?: unknown }).path;
    if (typeof path !== "string" || !allowedTarget(path, ctx.cwd, roots))
      return { block: true, reason: "big-brain: writes are limited to the wiki staging dirs" };
  });
}
