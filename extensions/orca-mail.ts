// Deliver Orca orchestration mail inline, the way Paseo delivers subagent results.
//
// Orca wakes a coordinator by typing a notice such as
//   You have 1 orchestration message. Run `orca orchestration check --run run_abc`.
// which costs the model a turn just to run the check. This extension catches that
// notice, runs the check itself, and replaces the notice with the messages
// (worker reports, questions, escalations). A stale notice whose mailbox is already
// empty is dropped without starting a turn.
//
// Active only under Orca. Set PI_ORCA_MAIL=off to disable.
import { execFile } from "node:child_process";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const NOTICE =
	/^\s*You have (\d+) orchestration messages?\.\s*Run `?[^`\s]*orca orchestration check(?: --run (run_[A-Za-z0-9_-]+))?`?\.?\s*$/;

type Mail = {
	id?: string;
	type?: string;
	from?: string;
	subject?: string;
	body?: string;
	payload?: { taskId?: string; dispatchId?: string; outcome?: string; filesModified?: string[] };
};

export function isOrca(env = process.env): boolean {
	return Boolean(env.ORCA_PANE_KEY || env.ORCA_AGENT_SESSION_ID || env.ORCA_CLI_BIN_DIR);
}

export function parseNotice(text: string): { count: number; run?: string } | undefined {
	const m = NOTICE.exec(text);
	return m ? { count: Number(m[1]), run: m[2] } : undefined;
}

export function formatMail(messages: Mail[], run?: string): string {
	const head = `Orca delivered ${messages.length} orchestration message${messages.length === 1 ? "" : "s"}${
		run ? ` for ${run}` : ""
	} (already consumed; do not run \`orca orchestration check\` for these).`;
	const parts = messages.map((m, i) => {
		const ids = [
			m.payload?.taskId && `task ${m.payload.taskId}`,
			m.payload?.dispatchId && `dispatch ${m.payload.dispatchId}`,
			m.payload?.outcome && `outcome ${m.payload.outcome}`,
			m.id && `message ${m.id}`,
		]
			.filter(Boolean)
			.join(", ");
		const lines = [`### ${i + 1}. ${m.type ?? "message"} from ${m.from ?? "unknown"}: ${m.subject ?? ""}`.trimEnd()];
		if (ids) lines.push(`(${ids})`);
		if (m.payload?.filesModified?.length) lines.push(`Files modified: ${m.payload.filesModified.join(", ")}`);
		lines.push("", (m.body ?? "").trim() || "(no body)");
		if (m.type === "question" && m.id)
			lines.push("", `Answer with: orca orchestration reply --id ${m.id} --body "<answer>"`);
		return lines.join("\n");
	});
	return [head, ...parts].join("\n\n");
}

function check(run?: string): Promise<Mail[]> {
	const cli = process.env.ORCA_CLI_COMMAND || "orca";
	const args = ["orchestration", "check", "--json", ...(run ? ["--run", run] : [])];
	return new Promise((resolve, reject) => {
		execFile(cli, args, { timeout: 30_000, maxBuffer: 16 * 1024 * 1024 }, (err, stdout) => {
			if (err) return reject(err);
			try {
				const d = JSON.parse(stdout);
				if (!d.ok) return reject(new Error(JSON.stringify(d.error ?? d)));
				resolve(d.result?.messages ?? []);
			} catch (e) {
				reject(e);
			}
		});
	});
}

export default function (pi: ExtensionAPI) {
	if (!isOrca() || process.env.PI_ORCA_MAIL === "off") return;
	pi.on("input", async (event, ctx) => {
		const notice = parseNotice(event.text ?? "");
		if (!notice) return { action: "continue" };
		let messages: Mail[];
		try {
			messages = await check(notice.run);
		} catch {
			return { action: "continue" }; // let the model run the check itself
		}
		if (messages.length === 0) {
			ctx.ui?.notify?.("Orca notice had no unread mail; skipped.", "info");
			return { action: "handled" };
		}
		return { action: "transform", text: formatMail(messages, notice.run) };
	});
}
