import { mkdir, rename, writeFile } from "node:fs/promises";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { homedir } from "node:os";
import { createHash, randomBytes } from "node:crypto";
import { looksSecret } from "./forum.ts";

export const CHUNK_BYTES = 60 * 1024;
export const INDEX_CAP = 2048;
export const MAX_PAGES = 20;
export const MAX_PAGE_LINES = 40;
export const GLOBAL_TYPES = ["preference", "environment", "lesson"] as const;
export const PROJECT_TYPES = ["decision", "gotcha"] as const; // plus the fixed name overview.md

export type Entry = { type: string; id: string; timestamp?: string; message?: { role?: string; content?: unknown } };
export type Reg = { sessionFile: string; projectRoot: string | null; pid: number };
export type SessState = { marker: string | null; failures: number; status: "active" | "done" | "skipped" };
export type State = Record<string, SessState>;
export type Part = { id: string; text: string };
export type Chunk = { text: string; lastId: string };

const ORCA_WORKER = "You are working inside Orca, a multi-agent IDE. You are a dispatched worker";

export function isOff(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.PI_BIG_BRAIN === "off";
}

export function stateDir(home: string = homedir()): string {
  return join(home, ".pi", "agent", "wiki-state");
}

export function globalWiki(home: string = homedir()): string {
  return join(home, ".pi", "agent", "wiki");
}

export function projectWiki(projectRoot: string): string {
  return join(projectRoot, ".pi", "wiki");
}

export function parseEntries(raw: string): Entry[] {
  const out: Entry[] = [];
  for (const line of raw.split("\n")) {
    if (!line.trim()) continue;
    try {
      const o = JSON.parse(line);
      if (o && typeof o === "object" && typeof o.type === "string" && typeof o.id === "string") out.push(o);
    } catch {
      // skip malformed line
    }
  }
  return out;
}

export function sliceAfter(entries: Entry[], marker: string | null, end: string): Entry[] {
  const from = marker === null ? 0 : entries.findIndex((e) => e.id === marker) + 1;
  const to = entries.findIndex((e) => e.id === end);
  return to < from ? [] : entries.slice(from, to + 1);
}

export function userCount(entries: Entry[]): number {
  return entries.filter((e) => e.type === "message" && e.message?.role === "user").length;
}

function texts(content: unknown): string[] {
  if (typeof content === "string") return [content];
  if (!Array.isArray(content)) return [];
  return content.filter((c) => c?.type === "text" && typeof c.text === "string").map((c) => c.text);
}

export function condense(entries: Entry[]): Part[] {
  const out: Part[] = [];
  for (const e of entries) {
    if (e.type !== "message") continue;
    const { role, content } = e.message ?? {};
    const lines: string[] = [];
    if (role === "user") {
      const t = texts(content).filter(Boolean).join("\n");
      if (t) lines.push(`USER: ${t}`);
    } else if (role === "assistant") {
      const t = texts(content).filter(Boolean).join("\n");
      if (t) lines.push(`ASSISTANT: ${t}`);
      if (Array.isArray(content))
        for (const c of content)
          if (c?.type === "toolCall") lines.push(`TOOL ${c.name}: ${String(JSON.stringify(c.arguments ?? {})).slice(0, 200)}`);
    }
    if (lines.length) out.push({ id: e.id, text: lines.join("\n") });
  }
  return out;
}

const bytes = (s: string) => Buffer.byteLength(s, "utf8");

function cut(text: string, max: number): string {
  if (bytes(text) <= max) return text;
  const mark = "\n[truncated]";
  // toString drops a split multibyte char as U+FFFD; trim it so the cap still holds
  let head = Buffer.from(text, "utf8").subarray(0, max - bytes(mark)).toString("utf8");
  while (bytes(head) > max - bytes(mark)) head = head.slice(0, -1);
  return head + mark;
}

export function chunk(parts: Part[], end: string, max: number = CHUNK_BYTES): Chunk[] {
  const out: Chunk[] = [];
  let cur: Chunk | null = null;
  for (const p of parts) {
    const text = cut(p.text, max);
    if (cur && bytes(cur.text) + 1 + bytes(text) <= max) {
      cur.text += "\n" + text;
      cur.lastId = p.id;
    } else {
      if (cur) out.push(cur);
      cur = { text, lastId: p.id };
    }
  }
  if (cur) out.push(cur);
  if (out.length) out[out.length - 1].lastId = end;
  return out;
}

export function citation(_sessionFile: string, sessionId: string, date: string): string {
  return `[s:${date.slice(0, 10)} ${sessionId.slice(0, 6)}]`;
}

export function workerPrompt(firstUser: string): boolean {
  return firstUser.startsWith(ORCA_WORKER) || firstUser.trimStart().startsWith("<paseo-system");
}

export function digestible(env: NodeJS.ProcessEnv, hasUI: boolean, firstUser: string): boolean {
  return !isOff(env) && hasUI && !env.ORCA_TERMINAL_HANDLE?.startsWith("structworker_") && !workerPrompt(firstUser);
}

export function areas(projectRoot: string): string[] {
  let dirs: string[] = [];
  try {
    dirs = readdirSync(projectRoot, { withFileTypes: true })
      .filter((d) => d.isDirectory() && !d.name.startsWith("."))
      .map((d) => d.name.toLowerCase());
  } catch {
    // no repo dir: only the fixed areas
  }
  return [...new Set([...dirs, "db", "cross"])];
}

export function validPageName(name: string, kind: "global" | "project", areas: string[]): boolean {
  if (kind === "global") return new RegExp(`^(${GLOBAL_TYPES.join("|")})-[a-z0-9-]+\\.md$`).test(name);
  if (name === "overview.md") return true;
  const m = new RegExp(`^(${PROJECT_TYPES.join("|")})-(.+)\\.md$`).exec(name);
  return !!m && areas.some((a) => m[2].startsWith(`${a}-`) && /^[a-z0-9-]+$/.test(m[2].slice(a.length + 1)));
}

export function validateWiki(dir: string, kind: "global" | "project", areas: string[]): string | null {
  let ents;
  try {
    ents = readdirSync(dir, { withFileTypes: true });
  } catch (e) {
    return `cannot read ${dir}: ${(e as Error).message}`;
  }
  const pages: string[] = [];
  for (const d of ents) {
    if (kind === "global" && d.name === ".git" && d.isDirectory()) continue;
    if (!d.isFile()) return `not a file: ${d.name}`;
    if (d.name === "index.md") continue;
    if (!validPageName(d.name, kind, areas)) return `invalid page name: ${d.name}`;
    pages.push(d.name);
  }
  if (pages.length > MAX_PAGES) return `too many pages: ${pages.length} > ${MAX_PAGES}`;
  for (const p of pages) {
    const text = readFileSync(join(dir, p), "utf8");
    if (looksSecret(text)) return `secret in ${p}`;
    const n = text.trimEnd().split("\n").length;
    if (n > MAX_PAGE_LINES + 10) return `page too long: ${p} (${n} lines)`;
  }
  if (existsSync(join(dir, "index.md"))) {
    const index = readFileSync(join(dir, "index.md"), "utf8");
    if (looksSecret(index)) return "secret in index.md";
    for (const [, link] of index.matchAll(/\]\(([^)]+\.md)\)/g))
      if (!pages.includes(link)) return `index links missing page: ${link}`;
  }
  return null;
}

function capIndex(index: string, dir: string): string {
  let t = index.trim();
  if (bytes(t) > INDEX_CAP) {
    t = Buffer.from(t, "utf8").subarray(0, INDEX_CAP).toString("utf8");
    t = t.slice(0, Math.max(0, t.lastIndexOf("\n")));
  }
  return t.replace(/\]\(([^)/]+\.md)\)/g, `](${dir}/$1)`);
}

export function injectBlock(
  globalIndex: string | null,
  projectIndex: string | null,
  globalDir: string,
  projectDir: string | null,
): string {
  const g = globalIndex?.trim() ? capIndex(globalIndex, globalDir) : "";
  const p = projectIndex?.trim() && projectDir ? capIndex(projectIndex, projectDir) : "";
  if (!g && !p) return "";
  return [
    "## Memory wiki",
    "Notes kept from your past sessions with this user. Each index line is a page path and what it covers.",
    "Before you start a task, check the summaries below. Read every page whose summary covers the task (how the user",
    "wants something done, this machine, this project) with the read tool, then follow it. If the user's current message",
    "contradicts a page, the message wins.",
    ...(g ? [`### Global wiki (${globalDir}/)`, g] : []),
    ...(p ? [`### Project wiki (${projectDir}/)`, p] : []),
  ].join("\n");
}

export function regFile(home: string, sessionFile: string): string {
  return join(stateDir(home), "sessions", `${createHash("sha1").update(sessionFile).digest("hex")}.json`);
}

export async function writeAtomic(path: string, data: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const tmp = `${path}.${randomBytes(4).toString("hex")}.tmp`;
  await writeFile(tmp, data);
  await rename(tmp, path);
}

export type Candidate = { sessionFile: string; users: number; mtimeMs: number; calls: number };

export function rankInit(c: Candidate[], n: number): Candidate[] {
  return [...c].sort((a, b) => b.users - a.users || b.mtimeMs - a.mtimeMs).slice(0, n);
}
