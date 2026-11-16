# git-gud v2: proposed changes

Status: proposal only. Nothing in `skills-orca/git-gud/SKILL.md` has been changed.

Source: 68 Pi sessions from the last 30 days that used `git-gud` or `sol-git-gud`, including 23 Orca runs from Nov 7 to 15.

## Problems found

| # | Problem | Evidence |
|---|---|---|
| 1 | Approval gate skipped | `orca worktree create` ran before spec approval. You said: "hey i did not give you approval yet" (prompt-toxicity, Nov 12). |
| 2 | Stage not visible | You asked: "what is the next step after my approval?" (new_bsa_react, Nov 10). |
| 3 | `bd init` fails in worktrees | It failed 4 times with "Found existing Dolt database" (codec_new, s3-middleware, subagent-graph). |
| 4 | Cleanup trial and error | `orca worktree rm --help` was looked up about 10 times, plus `terminal close --help`. |
| 5 | Idle workers | "went idle mid-suite" (s3-middleware, twice), "stopped mid-run" (new_bsa_react), and a reviewer that ended without a verdict (adverse-news-engine, Nov 16). Most of these workers woke up again on their own when their background test run finished. |
| 6 | Fix cycle used up | The coordinator applied an unreviewed fix itself (new_bsa_react, Nov 9). |
| 9 | Wrong launch flags | `worker-start --agent pi --model` was refused, and `Unknown flag --from` appeared twice. |
| 10 | Copy drift | The old `sol-git-gud` copy (316 lines, Paseo) was loaded in 11 sessions. |
| 11 | Restarts | Orca restarted mid-run 10 times, and the state was rebuilt by hand each time. |

Out of scope for now: #7 (lanes waiting on each other) and #8 (`bd prime` costs about 37k tokens per worker).

## Decisions

- Before approval the agent may only read and run read-only commands. Approval needs exactly "lgtm" or "LGTM".
- After approval, show the remaining stages once.
- Idle workers: wait by default, and nudge only when a worker is silent and has no running process.
- After a restart, resume from a state file in the worktree.
- Beads: reuse the existing database and give each run its own label (see E3).
- Cleanup: close terminals automatically, and ask before removing a worktree.
- Review: allow a small fix after the fix cycle, labeled as unreviewed.
- Delete the old `sol-git-gud` copy.

## Proposed edits

### E1. Approval gate (#1, #2)

New section before "Pipeline Worktree":

> **Nothing is created before spec approval.** Until you approve, the agent may only read files and run read-only commands. Show the draft spec in chat. Create no worktree, files, beads or workers.
>
> End the spec with: *Reply "lgtm" to start.* Only a reply of exactly "lgtm" or "LGTM" counts. "approve", "nice", "lgtm but…" and similar replies continue the discussion. (Superseded by git-gud-v2-committee.md.)
>
> On approval, show the remaining stages once: plan → plan review → beads → final review → integration menu. Then say: "No more gates until the integration menu." After that, create the worktree and write the approved spec into it.

### E2. Pipeline Worktree timing (#1)

Change "Before writing the spec file, run `git branch --show-current`" to "**After spec approval**, run `git branch --show-current`".

### E3. Beads setup (#3)

A test of `BEADS_DIR` didn't isolate the run: the second `bd init` aborted and `bd` kept using the main checkout's `.beads`. A per-run label works with this `bd` version, because `bd create -l` adds labels and `bd ready -l` combines with `--assignee`.

Replace the `bd init` block:

```bash
bd where >/dev/null 2>&1 || bd init --stealth --non-interactive
L=gg:<topic>
A=$(bd create "Task A" -l "$L" --silent)
B=$(bd create "Task B" -l "$L" --silent)
bd dep "$A" --blocks "$B"
```

Add `-l "$L"` to every `bd ready` and `bd list`. The worker command becomes `bd ready -l gg:<topic> --assignee "$ORCA_TERMINAL_HANDLE" --json`. Never re-initialize an existing database.

### E4. Run State and Resume (#11)

New section:

> After approval, keep `<worktree>/.scratch/gg-state.json` with these fields: `stage`, `approved_at`, `label`, `beads: {id: {handle, dispatch, model}}`, `review_cycle_used`, `unreviewed_fixes`. Update it at every stage change and every dispatch.
>
> **After an Orca restart:** read the state file, then compare it with `bd list -l $L`, `git log`, `orca terminal list` and `orca orchestration check`. Re-dispatch only lanes whose terminal is gone, and never repeat committed work.

### E5. Idle workers and reviewers (#5)

Add to the worker prompt rules:

> Run any command that may take over 2 minutes (test suites, builds, dev servers) through the `process` tool, so you wake when it finishes. Always end the bead with `worker_done`.

Add to the coordinator rules:

> A worker that's idle while a background process runs is waiting, not stuck. Block on `orca orchestration check --wait`. Send at most one nudge, and only when the worker's turn ended with no running process and no `worker_done`. If it's still silent after that, reassign the bead and record the change in the state file. This applies to reviewers too: a reviewer without a verdict is not an approval.

### E6. Review policy (#6)

Add to "Bounded Final Review":

> When the single fix/re-review cycle is used up, the coordinator may fix small leftover findings itself. Each fix is at most about 20 lines, has passing tests and its own commit. In the final summary, list these under **Unreviewed changes**, with the commit and the finding it addresses. Anything larger goes under **Known issues** for the integration menu.

### E7. Cleanup (#4)

New section after the integration menu:

> Close each worker or reviewer terminal when its lane ends: `orca terminal close --terminal <handle> --json`.
>
> Remove the worktree only when the user says so: `orca worktree rm --worktree id:<id> [--delete-branch]`.
>
> Close the run's beads with `bd close`, filtered by `-l $L`.

### E8. Launch block (#9)

In Routing, replace the prose with one block to copy:

```bash
H=$(orca terminal create --worktree path:<P> --command "pi --model fedora/<m> --thinking <e>" --json | jq -r .result.terminal.handle)
orca orchestration worker-start --terminal "$H" --worktree path:<P> ...
```

Before applying, check the exact flags against `pi-agents`.

### D1. Copy drift (#10)

Delete `~/Desktop/hackaton_adm/.agents/skills/sol-git-gud/`.
