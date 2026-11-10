// Deliver Orca orchestration mail inline, the way Paseo delivers subagent results.
//
// Orca wakes a coordinator by typing a notice such as
//   You have 1 orchestration message. Run `orca orchestration check --run run_abc`.
// which costs the model a turn just to run the check. This extension catches that
// notice, runs the check itself, and replaces the notice with the messages
// (worker reports, questions, escalations). A stale notice whose mailbox is already
// empty is dropped without starting a turn.
//
// It also feeds Orca's subagent rows: when a bash result shows an
// `orca orchestration worker-start` receipt, it emits `subagent:async-started`
// on Pi's event bus (which Orca's own orca-agent-status extension listens to),
// and emits `subagent:async-complete` when that dispatch's worker_done arrives.
// Workers then show as child rows under the coordinator in Orca, like Paseo's
// subagent pill.
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

function orcaJson(args: string[]): Promise<any> {
	const cli = process.env.ORCA_CLI_COMMAND || "orca";
	return new Promise((resolve, reject) => {
		execFile(cli, [...args, "--json"], { timeout: 30_000, maxBuffer: 16 * 1024 * 1024 }, (err, stdout) => {
			if (err) return reject(err);
			try {
				const d = JSON.parse(stdout);
				d.ok ? resolve(d.result) : reject(new Error(JSON.stringify(d.error ?? d)));
			} catch (e) {
				reject(e);
			}
		});
	});
}

// Fill in a human label (task title, model) from Orca when the command didn't show it.
async function enrich(s: Started): Promise<Started> {
	const out = { ...s };
	try {
		if (!out.title && out.taskId) {
			const r = await orcaJson(["orchestration", "task-list", ...(out.runId ? ["--run", out.runId] : [])]);
			out.title = r?.tasks?.find((t: { id: string }) => t.id === out.taskId)?.title;
		}
		if (!out.model && out.terminal) {
			// Orca does not expose the launch command; pi-agents puts the model in the title.
			const r = await orcaJson(["terminal", "show", "--terminal", out.terminal]);
			const title: string = r?.terminal?.title ?? "";
			out.model = /\b(fedora\/[\w.-]+)/.exec(title)?.[1];
		}
	} catch {
		/* labels are best effort */
	}
	return out;
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

export type Started = { id: string; title?: string; model?: string; taskId?: string; runId?: string; terminal?: string };

// Find worker-start receipts in bash output. Returns one entry per started dispatch.
export function findStarts(command: string, output: string): Started[] {
	if (!/orchestration\s+worker-start/.test(command)) return [];
	const titles = [...command.matchAll(/--task-title[= ]+(?:"([^"]*)"|'([^']*)'|(\S+))/g)].map((m) => m[1] ?? m[2] ?? m[3]);
	const models = [...command.matchAll(/pi\s[^"'\n]*--model[= ]+([^\s"']+)/g)].map((m) => m[1]);
	const ids = [
		...[...output.matchAll(/"dispatchId"\s*:\s*"(ctx_[A-Za-z0-9_-]+)"[^{}]*?"state"\s*:\s*"(ready|starting|running)"/g)].map((m) => m[1]),
		// concise (non --json) receipt: dispatchId=ctx_… taskId=… state=ready
		...[...output.matchAll(/dispatchId=(ctx_[A-Za-z0-9_-]+)[^\n]*?state=(ready|starting|running)/g)].map((m) => m[1]),
	];
	const uniq = [...new Set(ids)];
	// Titles/models pair with receipts by order only when the counts line up; otherwise
	// label by dispatch id rather than guess.
	const pick = (xs: string[], i: number) => (xs.length === uniq.length ? xs[i] : xs.length === 1 && uniq.length === 1 ? xs[0] : undefined);
	const field = (id: string, key: string): string | undefined => {
		const j = new RegExp(`"dispatchId"\\s*:\\s*"${id}"[^{}]*?"${key}"\\s*:\\s*"([^"]+)"`).exec(output);
		const k = new RegExp(`dispatchId=${id}[^\\n]*?\\b${key}=(\\S+)`).exec(output);
		return j?.[1] ?? k?.[1];
	};
	return uniq.map((id, i) => ({
		id,
		title: pick(titles, i),
		model: pick(models, i),
		taskId: field(id, "taskId"),
		runId: field(id, "runId"),
		terminal: field(id, "terminal"),
	}));
}

// Find finished dispatches in check output or delivered mail.
export function findDone(output: string): string[] {
	const done = new Set<string>();
	for (const m of output.matchAll(/"type"\s*:\s*"worker_done"[\s\S]*?"dispatchId"\s*:\s*"(ctx_[A-Za-z0-9_-]+)"/g)) done.add(m[1]);
	for (const m of output.matchAll(/"dispatchId"\s*:\s*"(ctx_[A-Za-z0-9_-]+)"[^{}]*?"state"\s*:\s*"(succeeded|failed|stopped|abandoned|released)"/g)) done.add(m[1]);
	for (const m of output.matchAll(/dispatchId=(ctx_[A-Za-z0-9_-]+)[^\n]*?state=(succeeded|failed|stopped|abandoned|released)/g)) done.add(m[1]);
	for (const m of output.matchAll(/worker_done[^\n]*?dispatch(?:Id)?[=: ]+(ctx_[A-Za-z0-9_-]+)/g)) done.add(m[1]);
	return [...done];
}

function textOf(content: unknown): string {
	if (!Array.isArray(content)) return typeof content === "string" ? content : "";
	return content.map((c) => (c && typeof c === "object" && "text" in c ? String((c as { text: unknown }).text) : "")).join("\n");
}

export default function (pi: ExtensionAPI) {
	if (!isOrca() || process.env.PI_ORCA_MAIL === "off") return;
	const active = new Set<string>();
	const emit = (name: string, data: object) => (pi as { events?: { emit?: (n: string, d: object) => void } }).events?.emit?.(name, data);
	const started = async (s: Started) => {
		if (active.has(s.id)) return;
		active.add(s.id);
		const e = await enrich(s);
		if (!active.has(s.id)) return; // finished while we looked it up
		emit("subagent:async-started", { id: s.id, agent: e.model ?? "pi worker", description: e.title ?? s.id });
	};
	const finished = (id: string, failed = false) => {
		if (!active.delete(id)) return;
		emit(failed ? "task:subagent:lifecycle" : "subagent:async-complete", failed ? { id, status: "failed" } : { id });
	};

	pi.on("tool_result", async (event) => {
		if (event.toolName !== "bash") return;
		const command = String((event.input as { command?: unknown })?.command ?? "");
		if (!command.includes("orchestration")) return;
		const out = textOf(event.content);
		await Promise.all(findStarts(command, out).map(started));
		for (const id of findDone(out)) finished(id);
	});

	pi.on("input", async (event, ctx) => {
		const notice = parseNotice(event.text ?? "");
		if (!notice) return { action: "continue" };
		let messages: Mail[];
		try {
			messages = await check(notice.run);
		} catch {
			return { action: "continue" }; // let the model run the check itself
		}
		for (const m of messages)
			if (m.type === "worker_done" && m.payload?.dispatchId) finished(m.payload.dispatchId, m.payload.outcome === "failed");
		if (messages.length === 0) {
			ctx.ui?.notify?.("Orca notice had no unread mail; skipped.", "info");
			return { action: "handled" };
		}
		return { action: "transform", text: formatMail(messages, notice.run) };
	});
}
