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
  rankInit,
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
  for (const d of ["frontend", "Backend", ".git", "internal-gitlab-api", "parse_service"]) await mkdir(join(root, d), { recursive: true });
  await writeFile(join(root, "README.md"), "x");
  assert.deepEqual(areas(root).sort(), ["backend", "cross", "db", "frontend", "internal-gitlab-api", "parse-service"]);
  assert.deepEqual(areas(join(dir, "missing")).sort(), ["cross", "db"]);
});

test("validPageName", () => {
  const A = ["frontend", "db", "cross", "parse-service"];
  for (const n of ["lesson/x.md", "preference/commit-msgs.md", "environment/9router.md"])
    assert.equal(validPageName(n, "global", A), true, n);
  for (const n of ["lesson-x.md", "overview.md", "gotcha/x.md", "lesson/a/b.md", "notes/x.md", "preference/.md", "preference/A.md", "lesson/index.md"])
    assert.equal(validPageName(n, "global", A), false, n);
  for (const n of ["gotcha/frontend-x.md", "fact/db-y.md", "decision/cross-z.md", "gotcha/parse-service-x.md"])
    assert.equal(validPageName(n, "project", A), true, n);
  for (const n of ["overview.md", "gotcha-frontend-x.md", "gotcha/x.md", "gotcha/ui-x.md", "notes/frontend-x.md", "gotcha/frontend-X.md", "fact/parse_service-x.md", "gotcha/frontend-.md", "lesson/frontend-x.md", "gotcha/a/frontend-x.md"])
    assert.equal(validPageName(n, "project", A), false, n);
});

test("validateWiki", async () => {
  let n = 0;
  const wiki = async (files: Record<string, string>, dirs: string[] = []) => {
    const d = join(dir, `w${n++}`);
    await mkdir(d, { recursive: true });
    for (const s of dirs) await mkdir(join(d, s), { recursive: true });
    for (const [k, v] of Object.entries(files)) {
      await mkdir(join(d, k, ".."), { recursive: true });
      await writeFile(join(d, k), v);
    }
    return d;
  };
  const A = ["frontend", "db", "cross"];
  const ok = { "index.md": "### lesson\n- [lesson/a](lesson/a.md): a\n", "lesson/a.md": "fact [s:2026-11-21 abcdef]\n" };
  assert.equal(validateWiki(await wiki(ok), "global", A), null);
  assert.equal(validateWiki(await wiki({}), "global", A), null);
  assert.equal(validateWiki(await wiki(ok, [".git"]), "global", A), null);
  assert.notEqual(validateWiki(await wiki({}, [".git"]), "project", A), null);
  assert.equal(validateWiki(await wiki(ok, ["preference"]), "global", A), null, "empty type dir ok");
  assert.notEqual(validateWiki(await wiki({ ...ok, "lesson/b.md": "x" }), "global", A), null, "unlisted");
  assert.notEqual(validateWiki(await wiki({ "lesson/a.md": "x" }), "global", A), null, "unlisted, no index");
  assert.notEqual(validateWiki(await wiki({ ...ok, "index.md": ok["index.md"] + "- [b](lesson/b.md): b\n" }), "global", A), null, "dangling");
  assert.notEqual(validateWiki(await wiki({ ...ok, "lesson/sub/c.md": "x" }), "global", A), null, "nested");
  assert.notEqual(validateWiki(await wiki({ ...ok, "lesson/index.md": "x" }), "global", A), null, "index in type dir");
  const linked = { "index.md": ok["index.md"] + "- [lesson/index](lesson/index.md): i\n", "lesson/a.md": "x", "lesson/index.md": "x" };
  assert.notEqual(validateWiki(await wiki(linked), "global", A), null, "linked index in type dir");
  assert.notEqual(validateWiki(await wiki({ ...ok, "overview.md": "x" }), "project", A), null, "root overview");
  assert.notEqual(validateWiki(await wiki({ ...ok, ".hidden.md": "x" }), "global", A), null);
  assert.notEqual(validateWiki(await wiki({ ...ok, "notes/x.md": "x" }), "global", A), null);
  assert.notEqual(validateWiki(await wiki({ ...ok, "lesson/a.md": "key sk-ant-abcdefghijklmnopqrstu" }), "global", A), null);
  assert.notEqual(validateWiki(await wiki({ ...ok, "index.md": ok["index.md"] + "AKIAABCDEFGHIJKLMNOP" }), "global", A), null);
  assert.notEqual(validateWiki(await wiki({ ...ok, "lesson/a.md": "l\n".repeat(51) }), "global", A), null);
  const many: Record<string, string> = { "index.md": "### lesson\n" };
  for (let i = 0; i < 30; i++) {
    many[`lesson/p${i}.md`] = "x";
    many["index.md"] += `- [lesson/p${i}](lesson/p${i}.md): topic ${i}\n`;
  }
  assert.equal(validateWiki(await wiki(many), "global", A), null, "30 pages within cap");
  const bigIdx = ok["index.md"] + "x".repeat(INDEX_CAP);
  const big = await wiki({ ...ok, "index.md": bigIdx });
  assert.match(validateWiki(big, "global", A) ?? "", /index too big/);
  assert.equal(await readFile(join(big, "index.md"), "utf8"), bigIdx, "not truncated");
  assert.equal(validateWiki(await wiki({ "index.md": "### gotcha\n- [g](gotcha/db-x.md): g\n", "gotcha/db-x.md": "y" }), "project", A), null);
  assert.notEqual(validateWiki(join(dir, "nope"), "global", A), null);
});

test("injectBlock", () => {
  assert.equal(injectBlock(null, "", "/g", null), "");
  assert.equal(injectBlock("  \n", null, "/g", "/p"), "");
  const b = injectBlock("### lesson\n- [lesson/a](lesson/a.md): a\n", "### gotcha\n- [gotcha/frontend-x](gotcha/frontend-x.md): what\n", "/h/.pi/agent/wiki", "/r/.pi/wiki");
  assert.ok(b.startsWith("## Memory wiki\n"));
  assert.ok(b.includes("If the user's current message\ncontradicts a page, the message wins."));
  assert.ok(b.includes("### Global wiki (/h/.pi/agent/wiki/)\n### lesson\n- [lesson/a](/h/.pi/agent/wiki/lesson/a.md): a"));
  assert.ok(b.includes("### Project wiki (/r/.pi/wiki/)\n### gotcha\n- [gotcha/frontend-x](/r/.pi/wiki/gotcha/frontend-x.md): what"));
  const only = injectBlock(null, "- [f](fact/db-x.md): what", "/g", "/p");
  assert.ok(!only.includes("### Global wiki"));
  const big = Array.from({ length: 200 }, (_, i) => `- [lesson/p${i}](lesson/p${i}.md): topic ${i}`).join("\n");
  const whole = injectBlock(big, null, "/g", null);
  assert.ok(Buffer.byteLength(big) > INDEX_CAP);
  assert.ok(whole.includes("- [lesson/p199](/g/lesson/p199.md): topic 199"), "over-cap index injected whole");
});

test("writeAtomic leaves no tmp file", async () => {
  const p = join(dir, "atomic", "deep", "s.json");
  await writeAtomic(p, "one");
  await writeAtomic(p, "two");
  assert.equal(await readFile(p, "utf8"), "two");
  assert.deepEqual(await readdir(join(dir, "atomic", "deep")), ["s.json"]);
});

test("rankInit orders by users, then newest, and cuts at n", () => {
  const c = (sessionFile: string, users: number, mtimeMs: number) => ({ sessionFile, users, mtimeMs, calls: 1 });
  const ranked = rankInit([c("a", 2, 1), c("b", 5, 1), c("c", 2, 9), c("d", 3, 1)], 3);
  assert.deepEqual(ranked.map((r) => r.sessionFile), ["b", "d", "c"]);
});
