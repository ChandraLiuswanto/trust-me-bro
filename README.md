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
| `sol-git-gud` | The pipeline above |
| `pi-agents` | How Pi delegates to Paseo subagents: profiles, workspaces, prompts, handoffs, committees |
| `web-scraping` | Where to start a scraping job; indexes the four below |
| `web-scraping-data-sources` | Find the API, embedded JSON, or XHR before parsing HTML |
| `web-scraping-blocked` | Which fingerprint layer is refusing you, and what to change |
| `web-scraping-llm-extraction` | Model-based extraction, its costs, and prompt injection |
| `web-scraping-production` | Unattended scrapers and their silent failures |
| `writing-like-a-human` | Prose that doesn't read like a model wrote it |

## Requires

- [Pi](https://pi.dev) with [SoL-Pi](https://github.com/NVlabs/SoL-Pi)
- [Paseo](https://paseo.sh) with its MCP server available to Pi
- [beads](https://github.com/steveyegge/beads) (`bd`) on your PATH
- [obra/superpowers](https://github.com/obra/superpowers): `sol-git-gud` calls
  its `brainstorming`, `writing-plans`, `subagent-driven-development` and
  `finishing-a-development-branch` skills

The routing table in `sol-git-gud` names the models I run (Sol, Astra, Opus,
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
- The web-scraping skills are distilled from Asad Ikram's
  [scraping guide](https://asadfix.github.io/scraping-guide/)
- README layout borrowed from
  [phthomas/pstack-loki](https://github.com/phthomas/pstack-loki)

## License

MIT
