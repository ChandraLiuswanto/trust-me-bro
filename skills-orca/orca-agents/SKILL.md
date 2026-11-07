---
name: orca-agents
description: Use when Pi runs inside Orca and needs to delegate - a second opinion or advisor take from another model, handing off the current task, a committee for a hard or stuck problem, parallel independent agent tasks, or continuing prior delegated work.
---

# Orca Agents

## Overview

Route Pi delegation through **Orca orchestration workers**. Each worker is a supervised agent terminal in the Orca runtime, so it stays visible, reports `worker_done`, and wakes you when it finishes. Preserve model choice, conversation continuity, workspace safety, and asynchronous completion.

**Never delegate with `pi -p`, `pi --mode rpc`, background shells, or generic Pi `Agent`/`SubagentWorkflow` tools.** Those are invisible to Orca, unsupervised, and block your turn. If Orca orchestration fails, report the blocker and ask before using any other mechanism.

**REQUIRED:** Once per session, run `orca skills get orchestration --full` and read it. It is the authoritative contract for messaging, gates, and recovery. This skill adds Pi-specific launch rules on top of it.

## Calling Orca

Use the `orca` CLI through `bash`. Inside an Orca pane, `orca` resolves to the runtime's CLI and `ORCA_TERMINAL_HANDLE` identifies you as the coordinator. Pass `--json` and read handles and IDs from the receipt. Run `orca orchestration <command> --help` before using an unfamiliar verb; never guess flags.

## Repo, Workspace, Worker

| Paseo idea | Orca entity | ID usage |
|---|---|---|
| Project | Repo (`orca repo list`) | `--repo id:<id>` when creating worktrees |
| Workspace | Worktree, or a folder project | `--worktree current` means your own checkout |
| Subagent | Worker: a Dispatch of a Task in your Run, running in a terminal | `dispatchId` for read/stop/send, `terminal` handle for follow-up turns |

Your first `worker-start` with `--spec` creates and binds a Run for you. Later starts join that same Run automatically.

## Launching a Pi Worker on a Chosen Model

`worker-start --agent pi --model …` is **refused** (`Agent pi does not support launch-time model selection`). With plain `--agent pi`, the worker silently inherits Pi's default model. To control the model and effort, start Pi in a terminal yourself, then dispatch to that terminal:

```bash
H=$(orca terminal create --worktree current --title "[Review] Security · fedora/astra" \
      --command "pi --model fedora/astra --thinking high" --json \
    | python3 -c 'import json,sys;print(json.load(sys.stdin)["result"]["terminal"]["handle"])')
orca terminal wait --terminal "$H" --for tui-idle --timeout-ms 90000 --json >/dev/null
orca orchestration worker-start --worktree current --terminal "$H" \
  --task-title "Security review" --spec-file /tmp/spec-security.md --json
```

- Models go through the `fedora/` gateway (`fedora/opus`, `fedora/sol`, `fedora/astra`, and so on). To list the IDs, run `pi --list-models fedora`. Thinking levels are `off|minimal|low|medium|high|xhigh|max`. Never guess an ID.
- Read the handle from the receipt's `terminal.handle` field (inspect the JSON once if the shape differs).
- Title each terminal `"<role> · fedora/<model>"`. Always pass `--task-title` too. Orca's subagent rows under your agent show the task title and model.
- Write the spec to a file and pass `--spec-file`, so quotes and backticks need no escaping.
- `--agent pi` without a terminal is acceptable only when the default model is fine. If the user names another agent (`claude`, `codex`), use `--agent <id>`, and `--model` where Orca supports it.
- Start every independent worker in the same bash call, then **end your turn**. Orca wakes you with each worker's `worker_done`. Never sleep, poll `worker-show`, or block with `check --wait`.

## Core Contract

1. Choose the model per assignment from task fit. Prefer a different family for a second opinion. Tell the user which model you chose and why.
2. Give the worker a self-contained spec: objective, known context, absolute paths, constraints, expected output, and whether edits are allowed. Orca injects the reporting preamble (`worker_done`, `ask`), so do not restate those mechanics. Never write "do not run orca commands" in a spec: the worker obeys it, skips `worker_done`, and Orca escalates "stopped without reporting". Restrict specific actions instead ("do not start workers or edit files").
3. Start the worker or workers, record `dispatchId`, `taskId`, terminal handle and model in your plan, then end your turn.
4. When woken in a chat, each message arrives inline, whole, and already consumed: act on it and do not run `check`. Run `orca orchestration check --json` only when the wake names a `check` command (terminal sessions, or a message too large for chat). Each `worker_done` carries `taskId`, `dispatchId`, a subject and a body. If the body is not enough, read the full answer with `orca orchestration worker-read --dispatch <id> --source auto --json`.
5. Answer `question` mail with `orca orchestration reply --id <msg_id> --body …`. A question is not completion; keep waiting for `worker_done`.
6. Synthesize the results for the user and state your recommendation. Never paste raw worker output.

## Follow-ups and Cleanup

- **Talk to a worker, in any state:** `orca orchestration send --to dispatch:<id> --subject … --body …`. A working worker gets it when its current turn ends. A finished or closed worker gets it as a follow-up Task on the same terminal (receipt `delivery: follow_up`, new `dispatchId`), keeps its Pi context and model, and replies with `worker_done`. Do not create a new worker for a follow-up.
- **Never address a terminal handle.** `send --to term_…` lands in a terminal-only mailbox that nothing wakes; it stays unread until the agent runs `check` itself, and is lost when the terminal closes. Never steer by typing task text into a worker's terminal either.
- **Keep a worker open for the user:** pass `--keep-open` to `worker-start`, or run `orca orchestration worker-keep-open --dispatch <id>` later.
- **Change effort or model for a reused worker:** while it is idle, before the next follow-up, run `orca terminal send --terminal <H> --text "/thinking medium" --enter` or `--text "/model fedora/sol" --enter`.
- **One pending task per terminal.** Queue follow-ups for a busy worker.
- **Cleanup:** terminals you created stay open after `worker_done` (`worker-release` reports `retained`/`external_terminal`). Close each finished helper with `orca terminal close --terminal <H> --json`. Keep ongoing advisors open. Never close your own terminal or remove the worktree.
- **Stop runaway work:** `orca orchestration worker-stop --dispatch <id>`.

## Same-Worktree Pipelines

**Orca defaults toward new worktrees per task. Override that: pipeline stages, reviewers, and parallel editors run with `--worktree current`.**

- Record one canonical worktree (`ORCA_WORKTREE_ID` and the absolute checkout path). Pass `--worktree current` to every `terminal create` and `worker-start`. Never pass `new-child`, `new-top-level`, `--name`, or `--base-branch` unless the user explicitly asks for isolated checkouts.
- Give concurrent editors disjoint file ownership. Serialize overlapping edits and shared Git mutations. Reviewers are read-only.
- When collision risk appears, coordinate or serialize in this worktree. Do not create worktrees to preserve parallelism.
- If the user explicitly asks for isolation, use `--worktree new-child` on `worker-start`, and release that worker when done (new-worktree workers stay open).

## Prompt Readability Contract

Write every spec and follow-up as human-readable prose with normal word spacing and punctuation. Use this shape: a short objective sentence, then separate sentences or bullets for context, ownership, constraints, and expected output. Paths, identifiers, commands, and code keep their exact spelling. Before sending, reread the spec file once and expand any telegraphic word concatenations.

## Delegation Choices

| Situation | Orca action |
|---|---|
| One new task | One worker (Pi terminal on the chosen model, then `worker-start --terminal`) |
| Several independent tasks | Start all workers in one bash call, end the turn |
| Continue the same worker | `send --to dispatch:<last dispatchId>` |
| Read-only advice or review | Current worktree; the spec prohibits edits |
| Second opinion / advisor | One read-only worker on a contrasting model family; it returns a judgment, you decide |
| Hand off the current task, nothing comes back | Not a worker: `orca worktree create --no-parent --agent <id> --prompt "<briefing>" --json` (or `orca agent launch` in this checkout); tell the user its handle and end your turn |
| Hard or stuck problem (committee) | Two read-only workers on different families, same spec, in parallel; compare and synthesize |
| Explicitly requested isolated checkouts | `worker-start --worktree new-child` |

## Handoff Briefing

The receiving worker starts with zero context. Include the objective, current state, decisions and their reasons, failed attempts and why they failed, constraints, file paths, and acceptance criteria. Do not invent missing facts; investigate read-only or ask the user first.

## Common Mistakes

| Mistake | Correction |
|---|---|
| `pi -p --model …` subprocesses in bash | Orca workers; subprocesses are invisible and unsupervised |
| `worker-start --agent pi --model fedora/x` | Refused; create a `pi --model` terminal, then `--terminal` |
| `--agent pi` and assuming a model | It runs Pi's default; launch your own terminal to choose |
| Sleeping or polling `worker-show` | End the turn; Orca wakes you |
| `orca agent launch` for work that must report back | It has no Dispatch, so it never sends `worker_done` and mail to it is never delivered; use `worker-start` |
| `send --to term_…` or typing into a worker's terminal | `send --to dispatch:<id>` |
| Running `check` after an inline chat wake | The message is already consumed; act on it |
| New worker for a follow-up | `send --to dispatch:<id>` on the existing worker |
| New worktree per task | `--worktree current` unless the user asks for isolation |
| Leaving helper terminals open | `orca terminal close` after the final result |
| Returning raw worker output | Synthesize and recommend |
