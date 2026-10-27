---
name: pi-agents
description: Use when delegating work from Pi to subagents through Paseo - getting a second opinion or advisor take from another model, handing off the current task, forming a committee to plan a hard or stuck problem, running independent agent tasks in parallel, or continuing prior delegated work.
---

# Pi Agents

## Overview

Route Pi delegation through **Paseo MCP subagents**. Preserve provider choice, conversation continuity, workspace safety, and asynchronous completion.

**REQUIRED SUB-SKILL:** Read the `paseo` skill that ships with Paseo (usually `~/.agents/skills/paseo/SKILL.md`) before using this skill. Use the live MCP schema for argument names.

## Calling Paseo

Paseo tools are exposed through **codemode**, not as direct tools. Call them inside a `codemode` script as `await tools.mcp__paseo__<name>(args)`, for example `tools.mcp__paseo__list_profiles({})`. Use `describeTool("mcp__paseo__create_agent")` for the live schema. When creating several agents, issue every `create_agent` call in one script with `Promise.allSettled`.

## Project, Workspace, and Subagent

| Entity | Meaning | ID usage |
|---|---|---|
| Project | Registry entry grouping related workspaces | `projectId` on `create_workspace` selects an existing owner |
| Workspace | Working directory/checkout containing agents and terminals | `workspaceId` on `create_agent` selects placement |
| Agent / subagent | Conversation and worker; subagent means parent–child relationship | `agentId` for follow-ups and individual cleanup |

**Placement is not parentage.** Agent-scoped `create_agent` always creates your subagent. Omit `workspaceId` to inherit your current workspace. If the target repo is outside your workspace's directory, call `list_workspaces` and pass a matching `workspaceId`; if none exists, inherit your workspace and give absolute paths in the prompt. Passing another workspace changes placement, not parentage; it does not detach the child. Top-level creation without `workspaceId` instead creates a new local workspace. Detaching is an explicit user action, not an agent tool.

## Same-Workspace Pipelines

**Sol-git-gud runs its planner, implementers, reviewers, and fix iterations in the current workspace.** A new role, stage, provider, or parallel task needs an agent, not a new project or workspace.

- Record one canonical pipeline workspace ID and checkout path. Launch helpers with `create_agent`, omitting `workspaceId` when already in that workspace; a coordinator located elsewhere must pass the recorded `workspaceId` explicitly. Reuse `agentId` for follow-ups. All stages use that same checkout/worktree; never create per-task worktrees or branches.
- Assign disjoint file ownership to concurrent editors. Serialize overlapping edits and shared Git mutations. Reviewers are read-only.
- If collision risk appears, coordinate or serialize in this workspace. Do not automatically create workspaces/worktrees to preserve parallelism, even under deadline pressure.
- If the user explicitly requests isolated branches/checkouts or another workspace, use that placement. For new isolation, call `create_workspace(isolation: "worktree", path: <source checkout>, projectId: <known existing project>)`, then pass its returned `workspaceId` to `create_agent`. Omit unknown optional IDs; never substitute a project ID for a workspace ID.
- A second `local` workspace pointing at the same directory does not isolate files. A Git-worktree workflow instruction alone is not a request for a separate Paseo workspace per pipeline stage.

For cleanup, archive only tracked helper `agentId`s when finished. Keep ongoing advisors. Never archive the user's current workspace to clean up a pipeline: `archive_workspace` archives its agents and terminals too, and may remove an owned worktree.

## Core Contract

For a new delegation:

1. Call `list_profiles` and read every profile's `notes`.
2. If the user names a profile, select it. Otherwise choose by task fit; prefer a different provider family when a second opinion benefits from contrast.
3. If no profile fits, proceed with Paseo provider discovery (`list_providers`, `list_models`) and tell the user which model you chose and why; do not stop to ask. Never guess provider, model, mode, or feature IDs.
4. Materialize the selected profile into `create_agent`: join provider and model with the first slash only, so profile provider `pi` with model `fedora/opus` becomes `"pi/fedora/opus"`. Copy `modeId` and `thinkingOptionId` into `settings`, and copy the profile's `featureValues` into `settings.features`. **`create_agent` has no `profile` argument.**
5. Give the agent a self-contained prompt: objective, known context, relevant paths, constraints, expected output, and whether edits are allowed.
6. Leave `notifyOnFinish` enabled. Continue useful work or yield; do not sleep or poll.
7. Read the completed response and synthesize it for the user. If the finish notification is truncated, call `get_agent_activity` with the `agentId` for the full timeline.

When this skill triggers, use Paseo MCP through codemode. If Paseo is unavailable, report the blocker and ask before using any other delegation mechanism.

## Prompt Readability Contract

For every `create_agent.initialPrompt` and `send_agent_prompt.prompt`, write human-readable prose with normal word spacing and punctuation, including follow-ups, retries, and compact handoffs.

Use this shape: a short objective sentence, then separate sentences or bullets for relevant context, ownership, constraints, and expected output. Keep prompts concise by removing repetition and referencing known artifacts; preserve word boundaries. Paths, identifiers, commands, and code retain their exact spelling.

Before sending, read the actual prompt argument once and expand any telegraphic word concatenations into ordinary prose. Apply this check even under context pressure or when continuing a conversation whose earlier prompts used compressed wording.

Example: “Both reviews passed. Re-run the owned tests, then commit only the approved files. Return the commit hash.”

## Delegation Choices

| Situation | Paseo action |
|---|---|
| One new task | `create_agent` |
| Several known independent tasks | Issue multiple `create_agent` calls concurrently |
| Continue the same agent's work | `send_agent_prompt` with its `agentId` |
| Pipeline stages or parallel file edits | Current workspace; disjoint ownership or serialized edits |
| Explicitly requested isolated checkouts | Create worktree workspaces, then place agents using returned IDs |
| Read-only advice or review | Current workspace; explicitly prohibit edits |
| Ongoing advisor | Reuse the agent; archive only when finished |
| Second opinion / advisor | One read-only agent, preferably from a contrasting provider family; it returns a judgment, you decide |
| Hand off the current task | One agent with a full handoff briefing (see below); current workspace unless the user asks for a worktree |
| Hard or stuck problem (committee) | Two read-only agents from different provider families, launched in parallel with the same prompt; each does root-cause analysis and a plan; you compare and synthesize |

## Handoff Briefing

The receiving agent starts with zero context. The prompt must include: objective, current state, decisions and their reasons, failed attempts and why they failed, constraints, relevant file paths, and acceptance criteria. Do not invent missing facts; investigate read-only or ask the user first. Tell the user the new `agentId` after handing off.

## Example

User: “Ask three agents to review security, UX, and performance in parallel.”

1. Call `list_profiles` once and select each profile from its notes.
2. In one codemode script, create all three agents concurrently, materializing each selected profile:

```js
const roles = ["Security", "UX", "Performance"];
await Promise.allSettled(roles.map(role =>
  tools.mcp__paseo__create_agent({
    title: `[Review] ${role}`,
    provider: "provider/model",
    initialPrompt: `Review ${role.toLowerCase()} only. Cite file paths and evidence. Return ranked findings. Do not edit files.`,
    notifyOnFinish: true,
    settings: { modeId: "profile-mode", thinkingOptionId: "profile-thinking", features: {} }
  })
));
```

3. Await notifications without polling. Deduplicate findings, retain evidence and disagreements, then present one prioritized synthesis.

## Common Mistakes

| Mistake | Correction |
|---|---|
| `create_agent(profile=...)` | Materialize profile fields; no such argument exists |
| Calling `create_agent` as a direct tool | Call `tools.mcp__paseo__create_agent` inside codemode |
| Parallel agents in separate codemode calls | One script with `Promise.allSettled` |
| Falling back to another delegation mechanism silently | Report Paseo failure and ask first |
| Thin handoff prompt ("continue the auth work") | Full briefing: state, decisions, failed attempts, constraints, paths |
| Creating a new agent for a follow-up | Reuse `agentId` with `send_agent_prompt` |
| Polling `list_agents` for completion | Wait for the notification |
| “Collision risk means new workspaces” | Coordinate/serialize in the current workspace; isolation requires explicit intent |
| Treating a cross-workspace child as detached | Placement never changes parentage |
| Archiving the workspace to remove helpers | Archive tracked helper agents individually |
| Returning raw agent output | Synthesize the result and state your recommendation |
