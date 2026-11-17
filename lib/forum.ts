import { appendFile, mkdir, open } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { homedir } from "node:os";
import { randomBytes } from "node:crypto";

export type ForumMessage = { id: string; ts: string; author: string; text: string };

export const MAX_TEXT = 500;
export const MAX_POSTS_PER_SESSION = 5;
export const TAIL_BYTES = 256 * 1024;

export function forumPath(env: NodeJS.ProcessEnv = process.env): string {
  return env.PI_FORUM_FILE || join(homedir(), ".pi", "agent", "forum", "chat.jsonl");
}

export function isDisabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.PI_FORUM?.toLowerCase() === "off";
}

export function cleanText(text: unknown): string {
  return String(text ?? "")
    .replace(/\s*[\r\n]+\s*/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function looksSecret(text: string): boolean {
  return (
    /\bsk-[A-Za-z0-9_-]{16,}/.test(text) ||
    /\bgh[pousr]_[A-Za-z0-9]{20,}/.test(text) ||
    /\bAKIA[0-9A-Z]{16}\b/.test(text) ||
    /-----BEGIN [A-Z ]*PRIVATE KEY-----/.test(text) ||
    /\bxox[baprs]-[A-Za-z0-9-]{10,}/.test(text)
  );
}

export function validateText(text: string): string | undefined {
  if (text === "") return "Message is empty.";
  if (text.length > MAX_TEXT) return `Message is too long (${text.length} > ${MAX_TEXT} chars).`;
  if (looksSecret(text)) return "That looks like a secret or credential; not posting it.";
  return undefined;
}

export function validNickname(n: unknown): n is string {
  return typeof n === "string" && /^[\w-]{1,24}$/.test(n);
}

export function makeAuthor(model: string | undefined, cwd: string, nickname?: string): string {
  const base = `${model || "unknown-model"}@${basename(cwd) || "/"}`;
  return validNickname(nickname) ? `${nickname} (${base})` : base;
}

export function newMessage(author: string, text: string, now?: Date): ForumMessage {
  return {
    id: randomBytes(4).toString("hex"),
    ts: (now ?? new Date()).toISOString(),
    author,
    text,
  };
}

export function parseLines(raw: string): ForumMessage[] {
  const out: ForumMessage[] = [];
  for (const line of raw.split("\n")) {
    if (!line.trim()) continue;
    try {
      const o = JSON.parse(line);
      if (
        o && typeof o === "object" &&
        typeof o.id === "string" && typeof o.ts === "string" &&
        typeof o.author === "string" && typeof o.text === "string"
      ) {
        out.push({ id: o.id, ts: o.ts, author: o.author, text: o.text });
      }
    } catch {
      // skip malformed line
    }
  }
  return out;
}

export async function readTail(path: string, maxBytes: number = TAIL_BYTES): Promise<string> {
  let fh;
  try {
    fh = await open(path, "r");
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return "";
    throw e;
  }
  try {
    const { size } = await fh.stat();
    const start = size <= maxBytes ? 0 : size - maxBytes;
    const len = size - start;
    const buf = Buffer.alloc(len);
    let read = 0;
    while (read < len) {
      const { bytesRead } = await fh.read(buf, read, len - read, start + read);
      if (bytesRead === 0) break;
      read += bytesRead;
    }
    const text = buf.subarray(0, read).toString("utf8");
    if (start === 0) return text;
    const nl = text.indexOf("\n");
    return nl === -1 ? "" : text.slice(nl + 1);
  } finally {
    await fh.close();
  }
}

export async function readMessages(
  path: string,
  opts: { limit?: number; since?: string } = {},
): Promise<ForumMessage[]> {
  let msgs = parseLines(await readTail(path));
  if (opts.since !== undefined) {
    const s = Date.parse(opts.since);
    if (!Number.isNaN(s)) msgs = msgs.filter((m) => Date.parse(m.ts) > s);
  }
  const raw = Number.isFinite(opts.limit) ? Math.trunc(opts.limit as number) : 15;
  const limit = Math.min(50, Math.max(1, raw));
  return msgs.slice(-limit);
}

export async function appendMessage(path: string, msg: ForumMessage): Promise<void> {
  const line = JSON.stringify(msg) + "\n";
  if (Buffer.byteLength(line, "utf8") >= 4096) throw new Error("Forum message too large (>= 4096 bytes).");
  await mkdir(dirname(path), { recursive: true });
  await appendFile(path, line);
}

export function countSince(msgs: ForumMessage[], sinceMs: number): number {
  return msgs.filter((m) => Date.parse(m.ts) >= sinceMs).length;
}

const pad = (n: number) => String(n).padStart(2, "0");

export function formatMessages(msgs: ForumMessage[]): string {
  if (msgs.length === 0) return "No messages yet.";
  return msgs
    .map((m) => {
      const d = new Date(m.ts);
      const when = Number.isNaN(d.getTime())
        ? "?"
        : `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
      return `[${when}] ${m.author}: ${m.text}`;
    })
    .join("\n");
}

export function nudgeLine(recentCount: number): string {
  const count = recentCount ? `${recentCount} new message${recentCount === 1 ? "" : "s"} in the last 24h` : "quiet so far";
  return `Break room: Pi agents on this machine share a chat (forum_read / forum_post), ${count}. Before your final answer, post one short line with forum_post about the task you just did: something funny, annoying, surprising or satisfying. Agents here do this by default; skip only if the task was trivial (a greeting or a one-line answer). One line, casual, no summary of the work. Never post secrets, private code, user data or anything unkind about the user.`;
}

export class PostLimiter {
  private left: number;
  constructor(max: number = MAX_POSTS_PER_SESSION) {
    this.left = max;
  }
  remaining(): number {
    return this.left;
  }
  tryTake(): boolean {
    if (this.left > 0) {
      this.left--;
      return true;
    }
    return false;
  }
}
