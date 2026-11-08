---
name: orca-agents
description: Use when Pi runs inside Orca and needs to delegate - a second opinion or advisor take from another model, handing off the current task, a committee for a hard or stuck problem, parallel independent agent tasks, or continuing prior delegated work.
---

# Orca Agents

## Overview

Pi delegates through **Orca orchestration workers**: supervised, visible, and they wake you with `worker_done`. This skill holds only the Pi-specific rules. Orca's version-matched guide owns the general contract (wakes, `send`, `reply`, escalations, keep-open, spec shape, safety, recovery).

**REQUIRED, once per session, before the first Orca command:** load the `orchestration` skill, i.e. run `orca skills get orchestration` (use `$ORCA_CLI_COMMAND` instead of `orca` if it is set), and follow it. When it names a reference for your situation (task DAGs, remote placement, group messages, a failed or unknown worker, custom topology), load that with `orca skills get orchestration --reference references/<file>.md`. Use `orca orchestration <verb> --help` for flags; never guess them.

**Never delegate with `pi -p`, `pi --mode rpc`, background shells, or generic Pi `Agent`/`SubagentWorkflow` tools.** They are invisible to Orca, unsupervised, and block your turn. If Orca orchestration fails, report the blocker and ask before using anything else.

## Pi Worker on a Chosen Model

`worker-start --agent pi --model …` is **refused**, and plain `--agent pi` silently runs Pi's default model. To pick the model and effort, start Pi in a terminal, then dispatch to it:

```bash
H=$(orca terminal create --worktree current --title "[Review] Security · fedora/astra" \
      --command "pi --model fedora/astra --thinking high" --json \
    | python3 -c 'import json,sys;print(json.load(sys.stdin)["result"]["terminal"]["handle"])')
orca terminal wait --terminal "$H" --for tui-idle --timeout-ms 90000 --json >/dev/null
orca orchestration worker-start --worktree current --terminal "$H" \
  --task-title "Security review" --spec-file /tmp/spec-security.md --json
```

- Model IDs come from `pi --list-models fedora` (`fedora/opus`, `fedora/sol`, `fedora/astra`, …). Thinking levels: `off|minimal|low|medium|high|xhigh|max`. Never guess an ID.
- Title each terminal `"<role> · fedora/<model>"` and always pass `--task-title`; Orca's subagent rows show both.
- Write specs to a file and pass `--spec-file`.
- Plain `--agent pi` only when the default model is fine. For another agent the user names (`claude`, `codex`), use `--agent <id>` and `--model` where Orca supports it.
- Choose the model from task fit, using a different family for second opinions, and tell the user which model you picked and why.
- Start all independent workers in one bash call, record `dispatchId`, `taskId`, handle and model in your plan, then **end your turn**. Orca wakes you with each `worker_done`. If its body is too thin, read the full answer with `orca orchestration worker-read --dispatch <id> --source auto --json`.

## Chat vs Terminal

| Result comes back to you? | Launch |
|---|---|
| Yes (review, second opinion, committee, pipeline stage) | Terminal worker, as above |
| No (handoff, "open a Pi chat", user will talk to it) | `orca agent launch --agent pi --surface chat --prompt "<briefing>" --json`; new checkout: `orca worktree create --name <n> --no-parent --agent pi --surface chat --prompt "<briefing>" --json`. Tell the user the handle and end your turn |

A Pi chat runs Pi's default model (`--model` is refused), has no Dispatch, never sends `worker_done`, and rejects `worker-start --terminal` (`terminal_handle_stale`). If the user asks for a chat but the work must report back, use a terminal worker and say why in one sentence.

## Pi-Specific Rules

- **Specs:** self-contained, readable prose with normal spacing. Include the objective, context, absolute paths, what may be edited, and the expected output. Reread the file once before sending. Orca injects the `worker_done`/`ask` preamble, so don't restate it. **Never write "do not run orca commands"**: the worker obeys, skips `worker_done`, and Orca escalates. Restrict specific actions instead ("do not start workers or edit files").
- **Handoff briefings:** the receiver starts with zero context. Include the current state, decisions and why, failed attempts, constraints, and acceptance criteria. Don't invent missing facts; investigate read-only or ask.
- **Follow-ups:** always `orca orchestration send --to dispatch:<id> --subject "<topic>" --body "<message>"`, which reuses the worker's Pi context and model. Never `send --to term_…` (no one is woken, and the mail is lost when the terminal closes), never type task text into its terminal, and don't start a new worker for a follow-up.
- **One pending task per terminal.** Queue follow-ups for a busy worker.
- **Retune a reused worker** while it is idle, before the next follow-up: `orca terminal send --terminal <H> --text "/thinking medium" --enter` or `--text "/model fedora/sol" --enter`.
- **Cleanup:** terminals you created stay open after `worker_done` (`retained`/`external_terminal`). Close finished helpers with `orca terminal close --terminal <H> --json`, but keep ongoing advisors. Never close your own terminal or remove the worktree.
- **Same worktree:** run stages, reviewers and parallel editors with `--worktree current`. Give concurrent editors disjoint files, serialize overlapping edits and Git mutations, and keep reviewers read-only. Use `new-child` only when the user asks for isolation, and release those workers when done.
- **Results:** synthesize and recommend. Never paste raw worker output.

## Delegation Choices

| Situation | Action |
|---|---|
| One task / several independent tasks | One Pi terminal worker each, all started in one call |
| Second opinion / advisor | One read-only worker on a contrasting family; it judges, you decide |
| Hard or stuck problem (committee) | Two read-only workers, different families, same spec; compare and synthesize |
| Continue earlier work | `send --to dispatch:<last dispatchId>` |
| Hand off, nothing comes back | Pi chat (see above), not a worker |
