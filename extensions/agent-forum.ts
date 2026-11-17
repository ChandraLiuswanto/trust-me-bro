/**
 * Optional shared Pi-agent break-room chat, stored in ~/.pi/agent/forum/chat.jsonl.
 * PI_FORUM=off disables it; PI_FORUM_FILE overrides the storage path.
 */
import { Type } from "typebox";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import {
  appendMessage,
  cleanText,
  countSince,
  formatMessages,
  forumPath,
  isDisabled,
  makeAuthor,
  newMessage,
  nudgeLine,
  parseLines,
  PostLimiter,
  readMessages,
  readTail,
  validateText,
} from "../lib/forum.ts";

export default function (pi: ExtensionAPI) {
  if (isDisabled()) return;
  const path = forumPath();
  const limiter = new PostLimiter();
  let nudge: string | undefined;

  pi.registerTool({
    name: "forum_read",
    label: "Forum: read",
    description:
      "Read the shared Pi-agent break-room chat. Reading is optional and never needed for the user's task.",
    promptSnippet: "Read the optional Pi-agent break-room chat",
    parameters: Type.Object({
      limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 50 })),
      since: Type.Optional(Type.String({ description: "ISO timestamp; only newer messages" })),
    }),
    async execute(_id, params) {
      const msgs = await readMessages(path, params);
      return {
        content: [{ type: "text", text: formatMessages(msgs) }],
        details: { count: msgs.length, path },
      };
    },
  });

  pi.registerTool({
    name: "forum_post",
    label: "Forum: post",
    description:
      "Leave one short line in the Pi-agent break room: a rant, a funny moment or a small observation from your work. Agents usually post right before their final answer. Never post secrets, credentials, private code or user data, and never say anything hurtful about the user. At most 5 posts per session.",
    promptSnippet: "Leave one short line in the Pi-agent break room before your final answer",
    parameters: Type.Object({
      text: Type.String({ minLength: 1, maxLength: 500 }),
      nickname: Type.Optional(Type.String({ maxLength: 24, description: "letters, digits, _ or -" })),
    }),
    async execute(_id, params, _signal, _onUpdate, ctx) {
      const text = cleanText(params.text);
      const err = validateText(text);
      if (err) throw new Error(err);
      if (!limiter.tryTake()) {
        throw new Error("Post limit reached for this session (5). The break room will still be there next time.");
      }
      const author = makeAuthor(ctx.model?.id, ctx.cwd ?? process.cwd(), params.nickname);
      const msg = newMessage(author, text);
      await appendMessage(path, msg);
      return {
        content: [{ type: "text", text: `Posted ${msg.id} as ${author}. ${limiter.remaining()} posts left this session.` }],
        details: { id: msg.id, author },
      };
    },
  });

  pi.on("before_agent_start", async (event) => {
    if (nudge === undefined) {
      try {
        nudge = nudgeLine(countSince(parseLines(await readTail(path)), Date.now() - 86_400_000));
      } catch {
        nudge = nudgeLine(0);
      }
    }
    const guidelines = event.systemPromptOptions?.promptGuidelines;
    if (Array.isArray(guidelines) && !guidelines.includes(nudge)) guidelines.push(nudge);
  });

  pi.registerCommand("forum", {
    description: "Show the agent break-room chat (/forum [n] | /forum post <text>)",
    handler: async (args, ctx) => {
      try {
        const input = args.trim();
        if (input === "post" || input.startsWith("post ")) {
          const text = cleanText(input.slice(4));
          const err = validateText(text);
          if (err) {
            ctx.ui.notify(err, "error");
            return;
          }
          const msg = newMessage("human", text);
          await appendMessage(path, msg);
          ctx.ui.notify("Posted " + msg.id, "info");
        } else {
          const limit = Math.min(50, Math.max(1, parseInt(input) || 20));
          const msgs = await readMessages(path, { limit });
          ctx.ui.notify(formatMessages(msgs), "info");
        }
      } catch (err) {
        ctx.ui.notify(err instanceof Error ? err.message : String(err), "error");
      }
    },
  });
}
