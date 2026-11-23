import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile, symlink, realpath } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import guard, { allowedTarget } from "../lib/big-brain-guard.ts";

const dir = await realpath(await mkdtemp(join(tmpdir(), "big-brain-guard-")));
after(() => rm(dir, { recursive: true, force: true }));
const root = join(dir, "root");
await mkdir(join(root, "sub"), { recursive: true });
await mkdir(join(dir, "root-evil"));
await mkdir(join(root, "lesson"));
await mkdir(join(dir, "elsewhere"));
await writeFile(join(root, "index.md"), "x");
await writeFile(join(dir, "outside.md"), "x");
await symlink(join(dir, "outside.md"), join(root, "link.md"));
await symlink(root, join(dir, "alias"));
await symlink(join(root, "lesson"), join(root, "linkin"));
await symlink(root, join(root, "loop"));
await symlink(join(dir, "elsewhere"), join(root, "linkout"));
const roots = [root];

test("allows new and existing pages directly in a root", () => {
  assert.equal(allowedTarget(join(root, "lesson-x.md"), dir, roots), true);
  assert.equal(allowedTarget(join(root, "index.md"), dir, roots), true);
  assert.equal(allowedTarget("root/lesson-x.md", dir, roots), true);
});

test("allows exactly one type-folder level, new or existing", () => {
  assert.equal(allowedTarget(join(root, "gotcha", "x.md"), dir, roots), true);
  assert.equal(allowedTarget(join(root, "lesson", "x.md"), dir, roots), true);
  assert.equal(allowedTarget("root/sub/x.md", dir, roots), true);
});

test("rejects outside, .., sibling prefix, nested, hidden, symlink", () => {
  assert.equal(allowedTarget(join(dir, "x.md"), dir, roots), false);
  assert.equal(allowedTarget(`${root}/../root/x.md`, dir, roots), false);
  assert.equal(allowedTarget(join(dir, "root-evil", "x.md"), dir, roots), false);
  assert.equal(allowedTarget(join(root, "a", "b", "x.md"), dir, roots), false);
  assert.equal(allowedTarget(join(root, "sub", "b", "x.md"), dir, roots), false);
  assert.equal(allowedTarget(join(root, ".x", "y.md"), dir, roots), false);
  assert.equal(allowedTarget(join(root, "linkin", "x.md"), dir, roots), false);
  assert.equal(allowedTarget(join(root, "linkout", "x.md"), dir, roots), false);
  assert.equal(allowedTarget(join(root, "loop", "x.md"), dir, roots), false);
  assert.equal(allowedTarget(join(root, "loop", "loop", "x.md"), dir, roots), false);
  assert.equal(allowedTarget(`${root}/lesson/../x.md`, dir, roots), false);
  assert.equal(allowedTarget(join(root, ".state.json"), dir, roots), false);
  assert.equal(allowedTarget(join(root, "link.md"), dir, roots), false);
  assert.equal(allowedTarget(join(root, "x.md"), dir, []), false);
});

test("a symlinked root path resolves to the realpath root", () => {
  assert.equal(allowedTarget(join(dir, "alias", "x.md"), dir, roots), true);
});

test("handler blocks write/edit outside roots and passes other tools", () => {
  process.env.BIG_BRAIN_ROOTS = join(dir, "alias");
  let handler: any;
  guard({ on: (_e: string, h: any) => (handler = h) } as any);
  const ctx = { cwd: dir };
  assert.equal(handler({ toolName: "write", input: { path: "root/x.md" } }, ctx), undefined);
  assert.equal(handler({ toolName: "edit", input: { path: "x.md" } }, ctx)?.block, true);
  assert.equal(handler({ toolName: "read", input: { path: "/etc/passwd" } }, ctx), undefined);
  process.env.BIG_BRAIN_ROOTS = "";
  guard({ on: (_e: string, h: any) => (handler = h) } as any);
  assert.equal(handler({ toolName: "write", input: { path: "root/x.md" } }, ctx)?.block, true);
});
