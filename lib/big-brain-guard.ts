/**
 * Loaded only into the big-brain updater child (via -e): write/edit may only touch pages
 * directly inside, or one folder level below, the staging dirs in BIG_BRAIN_ROOTS (colon-separated).
 */
import { lstatSync, realpathSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const within = (r: string, path: string) => path === r || path.startsWith(r + sep);

// Lexical check: abs = <root>/<file> or <root>/<type>/<file>, where <root> is a root path or a
// symlinked alias of one. No segment below it may be a dotfile or a symlink (even one pointing
// back into the root), so a link can never add depth or escape.
export function allowedTarget(target: string, cwd: string, roots: string[]): boolean {
  if (!target || target.split(/[\\/]/).includes("..")) return false;
  const abs = resolve(cwd, target);
  let prefix = abs;
  for (let n = 1; n <= 2; n++) {
    prefix = dirname(prefix);
    try {
      const isRoot =
        roots.includes(prefix) ||
        // an alias of a root must itself sit outside every root, else it is a link inside one
        (roots.includes(realpathSync(prefix)) &&
          !roots.some((r) => within(r, realpathSync(dirname(prefix)))));
      if (!isRoot) continue;
      const segs = relative(prefix, abs).split(sep);
      return segs.every((seg, i) => !seg.startsWith(".") && !isLink(join(prefix, ...segs.slice(0, i + 1))));
    } catch {
      // prefix does not exist: not a root alias
    }
  }
  return false;
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
