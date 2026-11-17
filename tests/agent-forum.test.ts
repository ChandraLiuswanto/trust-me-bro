import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  MAX_TEXT,
  cleanText,
  validateText,
  makeAuthor,
  parseLines,
  readTail,
  readMessages,
  appendMessage,
  newMessage,
  formatMessages,
  countSince,
  PostLimiter,
  isDisabled,
  forumPath,
  nudgeLine,
} from "../lib/forum.ts";

const dir = await mkdtemp(join(tmpdir(), "agent-forum-"));
after(() => rm(dir, { recursive: true, force: true }));

const msg = (i: number, ts?: string) => ({
  id: `id${i}`,
  ts: ts ?? new Date(Date.UTC(2026, 0, 1, 0, i)).toISOString(),
  author: "a",
  text: `message ${i}`,
});
const lines = (ms: object[]) => ms.map((m) => JSON.stringify(m) + "\n").join("");

test("cleanText flattens newlines and whitespace", () => {
  assert.equal(cleanText("a\n\n b\r\nc"), "a b c");
  assert.equal(cleanText("  a   b\t c "), "a b c");
  assert.equal(cleanText(undefined), "");
});

test("validateText", () => {
  assert.equal(validateText(""), "Message is empty.");
  assert.equal(validateText("x".repeat(MAX_TEXT)), undefined);
  assert.equal(validateText("x".repeat(MAX_TEXT + 1)), "Message is too long (501 > 500 chars).");
  assert.equal(validateText("this repo's tests are flaky lol"), undefined);
  const secretMsg = "That looks like a secret or credential; not posting it.";
  for (const s of [
    "key sk-ant-abcdefghijklmnopqrstu",
    "tok ghp_" + "a1B2c3D4e5".repeat(3),
    "aws AKIAABCDEFGHIJKLMNOP",
    "-----BEGIN RSA PRIVATE KEY----- MIIE",
    "slack xoxb-1234567890-abcdef",
  ]) {
    assert.equal(validateText(s), secretMsg, s);
  }
});

test("makeAuthor", () => {
  assert.equal(makeAuthor("opus", "/x/trust-me-bro"), "opus@trust-me-bro");
  assert.equal(makeAuthor("opus", "/x/trust-me-bro", "crab"), "crab (opus@trust-me-bro)");
  assert.equal(makeAuthor("opus", "/x/trust-me-bro", "bad name!"), "opus@trust-me-bro");
  assert.equal(makeAuthor(undefined, "/x/y"), "unknown-model@y");
});

test("parseLines skips malformed, incomplete and blank lines", () => {
  const good = msg(1);
  const raw =
    JSON.stringify(good) + "\n\nnot json\n" + JSON.stringify({ id: "x", ts: "t", author: "a" }) +
    "\n" + JSON.stringify({ id: 1, ts: "t", author: "a", text: "b" }) + "\n[1,2]\nnull\n";
  assert.deepEqual(parseLines(raw), [good]);
});

test("append/read round trip, limit, since", async () => {
  const p = join(dir, "nested", "deep", "chat.jsonl");
  assert.deepEqual(await readMessages(join(dir, "missing.jsonl")), []);
  const a = newMessage("me", "first", new Date("2026-01-01T00:00:00Z"));
  const b = newMessage("me", "second", new Date("2026-01-01T01:00:00Z"));
  await appendMessage(p, a);
  await appendMessage(p, b);
  assert.deepEqual(await readMessages(p), [a, b]);
  assert.deepEqual(await readMessages(p, { limit: 1 }), [b]);
  assert.deepEqual(await readMessages(p, { since: "2026-01-01T00:30:00Z" }), [b]);
  assert.deepEqual(await readMessages(p, { since: "garbage" }), [a, b]);
  assert.match(a.id, /^[0-9a-f]{8}$/);
});

test("default limit 15, clamp to 50", async () => {
  const p = join(dir, "many.jsonl");
  await writeFile(p, lines(Array.from({ length: 60 }, (_, i) => msg(i))));
  const d = await readMessages(p);
  assert.equal(d.length, 15);
  assert.equal(d[14].id, "id59");
  assert.equal((await readMessages(p, { limit: 500 })).length, 50);
  assert.equal((await readMessages(p, { limit: 0 })).length, 1);
});

test("readTail drops partial first line", async () => {
  const p = join(dir, "tail.jsonl");
  const ms = Array.from({ length: 20 }, (_, i) => msg(i));
  await writeFile(p, lines(ms));
  const tail = await readTail(p, 100);
  assert.ok(tail.length > 0 && tail.length <= 100);
  assert.ok(tail.endsWith("\n"));
  const parsed = tail.split("\n").filter(Boolean).map((l) => JSON.parse(l));
  assert.ok(parsed.length >= 1);
  assert.equal(parsed.at(-1).id, "id19");
  assert.equal(await readTail(join(dir, "nope")), "");
  assert.equal((await readTail(p)).length, lines(ms).length);
});

test("formatMessages", () => {
  assert.equal(formatMessages([]), "No messages yet.");
  const m = { id: "1", ts: new Date(2026, 0, 2, 3, 4).toISOString(), author: "bob", text: "hi" };
  assert.equal(formatMessages([m]), "[2026-01-02 03:04] bob: hi");
  assert.equal(formatMessages([{ ...m, ts: "bad" }]), "[?] bob: hi");
});

test("countSince over >50 messages via tail", async () => {
  const p = join(dir, "count.jsonl");
  await writeFile(p, lines(Array.from({ length: 60 }, (_, i) => msg(i))));
  const all = parseLines(await readTail(p));
  assert.equal(all.length, 60);
  assert.equal(countSince(all, Date.UTC(2026, 0, 1, 0, 0)), 60);
  assert.equal(countSince(all, Date.UTC(2026, 0, 1, 0, 30)), 30);
  assert.equal(countSince(all, Date.UTC(2027, 0, 1)), 0);
});

test("PostLimiter", () => {
  const l = new PostLimiter(2);
  assert.equal(l.tryTake(), true);
  assert.equal(l.tryTake(), true);
  assert.equal(l.tryTake(), false);
  assert.equal(l.remaining(), 0);
  assert.equal(new PostLimiter().remaining(), 5);
});

test("env helpers", () => {
  assert.equal(isDisabled({ PI_FORUM: "off" }), true);
  assert.equal(isDisabled({ PI_FORUM: "OFF" }), true);
  assert.equal(isDisabled({}), false);
  assert.equal(forumPath({ PI_FORUM_FILE: "/tmp/x.jsonl" }), "/tmp/x.jsonl");
  assert.match(forumPath({}), /\.pi\/agent\/forum\/chat\.jsonl$/);
  assert.match(forumPath({ PI_FORUM_FILE: "" }), /chat\.jsonl$/);
});

test("nudgeLine", () => {
  assert.match(nudgeLine(0), /quiet so far/);
  assert.match(nudgeLine(1), /1 new message in/);
  assert.match(nudgeLine(3), /3 new messages/);
  assert.match(nudgeLine(0), /When you finish a task, you may glance at forum_read/);
});
