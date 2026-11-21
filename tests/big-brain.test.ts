import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  CHUNK_BYTES,
  INDEX_CAP,
  isOff,
  stateDir,
  globalWiki,
  projectWiki,
  parseEntries,
  sliceAfter,
  userCount,
  condense,
  chunk,
  citation,
  workerPrompt,
  digestible,
  areas,
  validPageName,
  validateWiki,
  injectBlock,
  regFile,
  writeAtomic,
  type Entry,
} from "../lib/big-brain.ts";

const dir = await mkdtemp(join(tmpdir(), "big-brain-"));
after(() => rm(dir, { recursive: true, force: true }));

const PREAMBLE = "You are working inside Orca, a multi-agent IDE. You are a dispatched worker.";
const user = (id: string, text: string): Entry => ({ type: "message", id, message: { role: "user", content: text } });
const asst = (id: string, content: unknown): Entry => ({ type: "message", id, message: { role: "assistant", content } });

test("isOff and paths", () => {
  assert.equal(isOff({ PI_BIG_BRAIN: "off" }), true);
  assert.equal(isOff({}), false);
  assert.equal(stateDir("/h"), "/h/.pi/agent/wiki-state");
  assert.equal(globalWiki("/h"), "/h/.pi/agent/wiki");
  assert.equal(projectWiki("/r"), "/r/.pi/wiki");
  assert.match(regFile("/h", "/s/a.jsonl"), /^\/h\/\.pi\/agent\/wiki-state\/sessions\/[0-9a-f]{40}\.json$/);
});

test("parseEntries skips bad lines", () => {
  const raw = `{"type":"session","id":"s"}\nnot json\n\n{"type":"message","id":"a"}\n{"no":"id"}\n`;
  assert.deepEqual(parseEntries(raw).map((e) => e.id), ["s", "a"]);
});

test("condense", () => {
  const long = "x".repeat(500);
  const parts = condense([
    { type: "session", id: "s" },
    user("u1", "hello"),
    user("u2", [{ type: "text", text: "a" }, { type: "image" }, { type: "text", text: "b" }] as unknown as string),
    asst("a1", [
      { type: "thinking", thinking: "hmm" },
      { type: "text", text: "hi" },
      { type: "toolCall", name: "bash", arguments: { command: long } },
    ]),
    { type: "message", id: "t1", message: { role: "toolResult", content: [{ type: "text", text: "out" }] } },
    { type: "model_change", id: "m1" },
    asst("a2", [{ type: "text", text: "" }]),
  ]);
  assert.deepEqual(parts.map((p) => p.id), ["u1", "u2", "a1"]);
  assert.equal(parts[0].text, "USER: hello");
  assert.equal(parts[1].text, "USER: a\nb");
  const tool = `TOOL bash: ${JSON.stringify({ command: long }).slice(0, 200)}`;
  assert.equal(parts[2].text, `ASSISTANT: hi\n${tool}`);
});

test("chunk splits at boundaries and fixes lastId to end", () => {
  const p = (id: string, n: number) => ({ id, text: id.repeat(n) });
  const cs = chunk([p("a", 40), p("b", 40), p("c", 40)], "z", 100);
  assert.deepEqual(cs.map((c) => c.lastId), ["b", "z"]);
  assert.equal(cs[0].text, "a".repeat(40) + "\n" + "b".repeat(40));
  assert.equal(cs[1].text, "c".repeat(40));
  for (const c of cs) assert.ok(Buffer.byteLength(c.text) <= 100);
  assert.deepEqual(chunk([], "z"), []);
});

test("chunk cuts an oversize part", () => {
  const cs = chunk([{ id: "a", text: "x".repeat(10) }, { id: "b", text: "y".repeat(500) }], "b", 100);
  assert.equal(cs.length, 2);
  assert.equal(cs[0].lastId, "a");
  assert.equal(cs[1].lastId, "b");
  assert.ok(cs[1].text.endsWith("\n[truncated]"));
  assert.equal(Buffer.byteLength(cs[1].text), 100);
  assert.equal(CHUNK_BYTES, 60 * 1024);
});

test("sliceAfter and userCount", () => {
  const es = [user("1", "a"), asst("2", []), user("3", "b"), user("4", "c")];
  assert.deepEqual(sliceAfter(es, null, "3").map((e) => e.id), ["1", "2", "3"]);
  assert.deepEqual(sliceAfter(es, "1", "3").map((e) => e.id), ["2", "3"]);
  assert.deepEqual(sliceAfter(es, "4", "4"), []);
  assert.equal(userCount(es), 3);
  assert.equal(userCount(sliceAfter(es, "1", "3")), 1);
});

test("citation", () => {
  assert.equal(citation("/s/x.jsonl", "a1b2c3d4-ffff", "2026-11-21T14:38:13.130Z"), "[s:2026-11-21 a1b2c3]");
});

test("workerPrompt", () => {
  assert.equal(workerPrompt(PREAMBLE + " Your coordinator..."), true);
  assert.equal(workerPrompt("  <paseo-system>x"), true);
  assert.equal(workerPrompt("hi"), false);
});

test("digestible skip rules", () => {
  assert.equal(digestible({}, true, "hi"), true);
  assert.equal(digestible({ PI_BIG_BRAIN: "off" }, true, "hi"), false);
  assert.equal(digestible({}, false, "hi"), false);
  assert.equal(digestible({ ORCA_TERMINAL_HANDLE: "structworker_x" }, true, "hi"), false);
  assert.equal(digestible({ ORCA_TERMINAL_HANDLE: "term_1" }, true, "hi"), true);
  assert.equal(digestible({}, true, PREAMBLE), false);
  assert.equal(digestible({}, true, "<paseo-system>"), false);
});

test("areas", async () => {
  const root = join(dir, "repo");
  for (const d of ["frontend", "Backend", ".git", "internal-gitlab-api"]) await mkdir(join(root, d), { recursive: true });
  await writeFile(join(root, "README.md"), "x");
  assert.deepEqual(areas(root).sort(), ["backend", "cross", "db", "frontend", "internal-gitlab-api"]);
  assert.deepEqual(areas(join(dir, "missing")).sort(), ["cross", "db"]);
});

test("validPageName", () => {
  const A = ["frontend", "db", "cross"];
  for (const n of ["preference-commit-messages.md", "environment-9router.md", "lesson-x.md"])
    assert.equal(validPageName(n, "global", A), true, n);
  for (const n of ["notes.md", "gotcha-x.md", "overview.md", "preference-.md", "preference-A.md"])
    assert.equal(validPageName(n, "global", A), false, n);
  for (const n of ["overview.md", "gotcha-frontend-x.md", "gotcha-db-x.md", "gotcha-cross-x.md", "decision-db-alembic-baseline.md"])
    assert.equal(validPageName(n, "project", A), true, n);
  for (const n of ["overview-x.md", "gotcha-ui-x.md", "notes.md", "gotcha-frontend-.md", "preference-x.md", "decision-frontend.md"])
    assert.equal(validPageName(n, "project", A), false, n);
  assert.equal(validPageName("decision-internal-gitlab-api-auth.md", "project", ["internal-gitlab-api", "db", "cross"]), true);
});

test("validateWiki", async () => {
  let n = 0;
  const wiki = async (files: Record<string, string>, dirs: string[] = []) => {
    const d = join(dir, `w${n++}`);
    await mkdir(d, { recursive: true });
    for (const s of dirs) await mkdir(join(d, s), { recursive: true });
    for (const [k, v] of Object.entries(files)) await writeFile(join(d, k), v);
    return d;
  };
  const A = ["frontend", "db", "cross"];
  const ok = { "index.md": "- [lesson-a](lesson-a.md): a\n", "lesson-a.md": "fact [s:2026-11-21 abcdef]\n" };
  assert.equal(validateWiki(await wiki(ok), "global", A), null);
  assert.equal(validateWiki(await wiki({}), "global", A), null);
  assert.equal(validateWiki(await wiki(ok, [".git"]), "global", A), null);
  assert.notEqual(validateWiki(await wiki({}, [".git"]), "project", A), null);
  assert.notEqual(validateWiki(await wiki(ok, ["sub"]), "global", A), null);
  assert.notEqual(validateWiki(await wiki({ ...ok, ".hidden.md": "x" }), "global", A), null);
  assert.notEqual(validateWiki(await wiki({ ...ok, "notes.md": "x" }), "global", A), null);
  assert.notEqual(validateWiki(await wiki({ ...ok, "lesson-a.md": "key sk-ant-abcdefghijklmnopqrstu" }), "global", A), null);
  assert.notEqual(validateWiki(await wiki({ ...ok, "index.md": "AKIAABCDEFGHIJKLMNOP" }), "global", A), null);
  assert.notEqual(validateWiki(await wiki({ ...ok, "index.md": "- [x](lesson-b.md): b\n" }), "global", A), null);
  assert.notEqual(validateWiki(await wiki({ ...ok, "lesson-a.md": "l\n".repeat(51) }), "global", A), null);
  const many: Record<string, string> = {};
  for (let i = 0; i < 21; i++) many[`lesson-${i}.md`] = "x";
  assert.notEqual(validateWiki(await wiki(many), "global", A), null);
  assert.equal(validateWiki(await wiki({ "overview.md": "x", "gotcha-db-x.md": "y" }), "project", A), null);
  assert.notEqual(validateWiki(join(dir, "nope"), "global", A), null);
});

test("injectBlock", () => {
  assert.equal(injectBlock(null, "", "/g", null), "");
  assert.equal(injectBlock("  \n", null, "/g", "/p"), "");
  const b = injectBlock("- [lesson-a](lesson-a.md): a\n", "- [overview](overview.md): what\n", "/h/.pi/agent/wiki", "/r/.pi/wiki");
  assert.ok(b.startsWith("## Memory wiki\n"));
  assert.ok(b.includes("If the user's current message\ncontradicts a page, the message wins."));
  assert.ok(b.includes("### Global wiki (/h/.pi/agent/wiki/)\n- [lesson-a](/h/.pi/agent/wiki/lesson-a.md): a"));
  assert.ok(b.includes("### Project wiki (/r/.pi/wiki/)\n- [overview](/r/.pi/wiki/overview.md): what"));
  const only = injectBlock(null, "- [overview](overview.md): what", "/g", "/p");
  assert.ok(!only.includes("### Global wiki"));
  const big = Array.from({ length: 200 }, (_, i) => `- [lesson-${i}](lesson-${i}.md): topic ${i}`).join("\n");
  const capped = injectBlock(big, null, "/g", null);
  const idx = capped.slice(capped.indexOf("### Global wiki"));
  assert.ok(idx.includes("lesson-0") && !idx.includes("lesson-199"));
  const raw = big.slice(0, INDEX_CAP);
  const kept = raw.slice(0, raw.lastIndexOf("\n")).split("\n").length;
  assert.equal(idx.split("\n").length - 1, kept);
  assert.ok(idx.trimEnd().endsWith(`topic ${kept - 1}`));
});

test("writeAtomic leaves no tmp file", async () => {
  const p = join(dir, "atomic", "deep", "s.json");
  await writeAtomic(p, "one");
  await writeAtomic(p, "two");
  assert.equal(await readFile(p, "utf8"), "two");
  assert.deepEqual(await readdir(join(dir, "atomic", "deep")), ["s.json"]);
});
