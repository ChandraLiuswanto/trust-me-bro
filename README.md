# trust-me-bro

> You say "lgtm" once. Agents plan it, build it, review it, and then wait
> politely while you decide whether to merge. Trust me bro.

A skill stack for [Pi](https://pi.dev). It turns a rough idea into reviewed,
tested commits with one human approval, delegates the work to subagents
through [Paseo](https://paseo.sh), and carries a few working skills for
scraping and writing.

The name is a joke. The pipeline isn't: it has one review gate before code,
one after, a test requirement on every task, and it refuses to merge or push
without being told.

## How it works

```
rough idea ─► brainstorm ─► spec ─► "lgtm" ─► plan ─► plan review
                                       │
                                       ▼
            beads (bd) ─► parallel workers ─► final review ─► ≤1 fix cycle
                                                                  │
                                                                  ▼
                                         integration menu ─► waits for you
```

1. **Brainstorm to a spec.** The agent asks questions until it knows what you
   want, then writes the spec to `docs/superpowers/specs/`.
2. **One gate.** The spec is approved only when your whole reply is `no cap`,
   `autopilot`, or `lgtm`. "Looks good" doesn't count. "lgtm but rename X" is
   feedback, not approval.
3. **Autopilot.** Plan, one plan review, tasks as beads with dependencies,
   workers in parallel on disjoint files, TDD, one commit per task.
4. **Bounded review.** One final review, at most one fix and re-review. If it
   still fails, it stops and tells you instead of looping.
5. **You decide.** Merge locally, push and open a PR, or keep the branch.
   Nothing gets pushed without your word.

## The laws

1. **One human gate before code.** After the keyword, no check-ins.
2. **Approval isn't integration.** "lgtm" authorizes building, never merging.
3. **One workspace, one checkout.** Parallel work splits by files, not by
   worktrees.
4. **Reviews are bounded.** Two review rounds at most, then a human.
5. **Silence isn't success.** A missing verdict or a failed agent is a
   blocker, reported as one.

## Skills

| Skill | Job |
|---|---|
| `git-gud` | The pipeline above. Under Paseo it delegates through Paseo; under Orca, through Orca orchestration workers |
| `pi-agents` | How Pi delegates to subagents. Under Paseo: profiles, workspaces, prompts, handoffs, committees. Under Orca: model selection for Pi, `worker_done` handling, follow-ups, cleanup |
| `web-scraping` | The scraping decision ladder and status-code triage, with reference files for finding the data source, getting past blocks (plus proxies and vendors), LLM extraction, and running unattended |
| `writing-like-a-human` | Prose that doesn't read like a model wrote it |

### Host-scoped skills

Skills that drive Paseo live in `skills-paseo/` and load only when Pi runs
under Paseo (`PASEO_AGENT_ID` is set). The bundled `host-skills` extension adds
them, plus Paseo's own `~/.agents/skills/paseo`, at startup. An Orca session
(`ORCA_PANE_KEY`) loads `skills-orca/` instead. Shared skills in `skills/` load
everywhere.

Both hosts ship `git-gud` and `pi-agents` under the same names, so
prompts and cross-references work unchanged; only the host's copy loads.

Orca refuses `--model` for Pi workers, so Orca's `pi-agents` starts each worker as
`orca terminal create --command "pi --model fedora/<m> --thinking <lvl>"` and
then hands it work with `orca orchestration worker-start --terminal <handle>`.

The `orca-mail` extension makes worker results arrive like Paseo's. Orca wakes a
coordinator by typing "You have N orchestration messages. Run `orca orchestration
check`". The extension runs that check itself and replaces the notice with the
worker reports. A notice whose mailbox is already empty is dropped. It also puts each running worker in
Orca's subagent rows under the coordinator, labelled with the task title and
model, the way Paseo shows its subagent pill. A row clears when that worker
reports `worker_done`. Disable both with `PI_ORCA_MAIL=off`.

Orca installs its `orca-cli`, `orca-computer-use` and `orchestration` skills into the
shared `~/.agents/skills`. Exclude all three in `settings.json`. `host-skills` adds
`orca-cli` and `orca-computer-use` back under Orca. It leaves out `orchestration`
because, for Pi, that skill competes with `pi-agents`, which loads it on demand.

Force a set with `PI_HOST_SKILLS=paseo`, `PI_HOST_SKILLS=orca` or
`PI_HOST_SKILLS=none`. With `paseo,orca`, Paseo's `git-gud` and `pi-agents` win
the name collision and Orca's copies are skipped. To keep Paseo's skill out of other sessions, exclude it
in `~/.pi/agent/settings.json`:

```json
"skills": ["-/home/<you>/.agents/skills/paseo/SKILL.md"]
```

Check isolation with `bash tests/host-skills.sh --assert`.

## Requires

- [Pi](https://pi.dev) with [SoL-Pi](https://github.com/NVlabs/SoL-Pi)
- [Paseo](https://paseo.sh) with its MCP server available to Pi, or
  [Orca](https://github.com/stablyai/orca) (tested with 1.4.252 `orca serve`)
- [beads](https://github.com/steveyegge/beads) (`bd`) on your PATH
- [obra/superpowers](https://github.com/obra/superpowers): `git-gud` calls
  its `brainstorming`, `writing-plans`, `subagent-driven-development` and
  `finishing-a-development-branch` skills

The routing table in `git-gud` names the models I run (Sol, Astra, Opus,
Fable through Pi). Edit it to match yours.

## Install

```bash
pi install git:github.com/obra/superpowers
pi install git:github.com/NVlabs/SoL-Pi
pi install git:github.com/ChandraLiuswanto/trust-me-bro
```

Then start a Pi session and hand it something vague.

## Credits

- [obra/superpowers](https://github.com/obra/superpowers) by Jesse Vincent,
  which this pipeline is built on
- The web-scraping skill is distilled from Asad Ikram's
  [scraping guide](https://asadfix.github.io/scraping-guide/)
- README layout borrowed from
  [phthomas/pstack-loki](https://github.com/phthomas/pstack-loki)

## License

MIT
