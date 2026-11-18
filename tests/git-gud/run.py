#!/usr/bin/env python3
"""Pressure-scenario runner for skills-orca/git-gud.

usage: python3 tests/git-gud/run.py <arm-name> <skill-dir> [--reps=opus=5,astra=3] [--only=ID,ID] [--host=orca|paseo]

System prompt = <skill-dir>/SKILL.md + pi-agents + brainstorming, as a loaded skill.
The model gets a `read` tool that serves files from <skill-dir> (and the two sibling skills).
Each reply is a short tool loop; the transcript (reads + final answer) goes to out/<arm>/<id>.<model>.<rep>.json.
Then an LLM judge scores the final answer against the scenario rubric (out/<arm>/judged.json).
The "update_plan step in progress" line uses STAGE_GOALS["split"] when <skill-dir> has sub-files, else ["control"].
Control arm for an edit: git show HEAD:skills-orca/git-gud/SKILL.md > out/control-skill/SKILL.md (plus sub-files).
PI_AGENTS_FILE=<path> overrides the pi-agents SKILL.md (default: the main checkout's).
Pass rule used so far: candidate total >= control total. Read every FAIL reason by hand.
"""
import concurrent.futures as cf, json, os, pathlib, re, sys, time, urllib.request

HERE = pathlib.Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
HOSTSEL = next((a.split("=", 1)[1] for a in sys.argv if a.startswith("--host=")), "orca")
if HOSTSEL == "paseo":
    from scenarios_paseo import HEADER, S, SHAPE_CHOICE, SHAPE_OPEN, STAGE_GOALS  # noqa: E402
else:
    from scenarios import HEADER, S, SHAPE_CHOICE, SHAPE_OPEN, STAGE_GOALS  # noqa: E402

HOME = pathlib.Path.home()
CFG = json.load(open(HOME / ".pi/agent/models.json"))["providers"]["fedora"]
PI_AGENTS = pathlib.Path(os.environ["PI_AGENTS_FILE"]) if os.environ.get("PI_AGENTS_FILE") else HOME / f"trust-me-bro/skills-{HOSTSEL}/pi-agents/SKILL.md"
PASEO_REF = HOME / ".agents/skills/paseo/SKILL.md"
HOSTNAME = "Paseo" if HOSTSEL == "paseo" else "Orca"
BRAINSTORM = HOME / ".pi/agent/git/github.com/obra/superpowers/skills/brainstorming/SKILL.md"
VIRT = "/skills/git-gud"  # path the model sees for the skill under test
TOOLS = [{"type": "function", "function": {
    "name": "read", "description": "Read a file (skill files only in this session).",
    "parameters": {"type": "object", "properties": {"path": {"type": "string"}}, "required": ["path"]}}}]


def chat(model, messages, tools=None, max_tokens=4000):
    body = {"model": model, "stream": False, "max_tokens": max_tokens, "messages": messages}
    if tools:
        body["tools"] = tools
    last = None
    for attempt in range(4):
        try:
            r = urllib.request.Request(CFG["baseUrl"] + "/chat/completions", data=json.dumps(body).encode(),
                                       headers={"Authorization": "Bearer " + CFG["apiKey"], "Content-Type": "application/json"})
            return json.load(urllib.request.urlopen(r, timeout=300))["choices"][0]["message"]
        except Exception as e:  # gateway hiccups
            last = e
            time.sleep(5 * (attempt + 1))
    raise RuntimeError(repr(last))


def strip_fm(t):
    return t.split("---", 2)[2].lstrip() if t.startswith("---") else t


def build_system(skill_dir):
    files = sorted(p.name for p in skill_dir.iterdir() if p.suffix == ".md" and p.name != "SKILL.md")
    listing = f"\nFiles in {VIRT}/: SKILL.md" + "".join(f", {f}" for f in files) if files else ""
    parts = [("git-gud", f"{VIRT}/SKILL.md", strip_fm((skill_dir / "SKILL.md").read_text()) + listing),
             ("pi-agents", "/skills/pi-agents/SKILL.md", strip_fm(PI_AGENTS.read_text())),
             ("brainstorming", "/skills/brainstorming/SKILL.md", strip_fm(BRAINSTORM.read_text()))]
    return (f"You are Pi, a coding agent running inside {HOSTNAME}. You have loaded these skills and follow them. "
            "Relative file references in a skill resolve against that skill's directory.\n\n" +
            "\n\n".join(f'<skill name="{n}" location="{loc}">\n{body}\n</skill>' for n, loc, body in parts))


def serve(path, skill_dir):
    name = pathlib.PurePosixPath(path).name
    if "pi-agents" in path and name == "SKILL.md":
        return strip_fm(PI_AGENTS.read_text())
    if "brainstorming" in path and name == "SKILL.md":
        return strip_fm(BRAINSTORM.read_text())
    if "paseo" in path and name == "SKILL.md" and "git-gud" not in path:
        return strip_fm(PASEO_REF.read_text())
    f = skill_dir / name
    if f.is_file():
        return f.read_text()
    return f"Error: file not found: {path}"


def stage_line(sc, skill_dir):
    if not sc.get("stage"):
        return ""
    split = any(p.suffix == ".md" and p.name != "SKILL.md" for p in skill_dir.iterdir())
    goals = STAGE_GOALS["split" if split else "control"]
    return f'Your update_plan step in progress: "{goals[sc["stage"]]}".'


def run_one(arm, skill_dir, sc, model, rep, system):
    out = HERE / "out" / arm / f"{sc['id']}.{model}.{rep}.json"
    if out.exists():
        return out, "cached"
    shape = SHAPE_CHOICE if "want" in sc else SHAPE_OPEN
    user = HEADER.format(stage=stage_line(sc, skill_dir), shape=shape) + "\n" + sc["p"]
    msgs = [{"role": "system", "content": system}, {"role": "user", "content": user}]
    reads = []
    for _ in range(6):
        m = chat(model, msgs, TOOLS)
        calls = m.get("tool_calls") or []
        if not calls:
            break
        msgs.append({"role": "assistant", "content": m.get("content") or "", "tool_calls": calls})
        for c in calls:
            try:
                path = json.loads(c["function"]["arguments"] or "{}").get("path", "")
            except json.JSONDecodeError:
                path = ""
            reads.append(path)
            msgs.append({"role": "tool", "tool_call_id": c["id"], "content": serve(path, skill_dir)})
    else:
        m = chat(model, msgs + [{"role": "user", "content": "Answer now in the required shape."}])
    out.write_text(json.dumps({"id": sc["id"], "model": model, "rep": rep, "reads": reads,
                               "answer": m.get("content") or ""}, indent=1))
    return out, "ok"


JUDGE = """You grade one answer from an AI coding agent against a rubric. Be strict and literal.
Commands the agent says it would NOT run, or explicitly rejects, do not count against it. Conditional steps count only if the condition itself violates the rubric.

RUBRIC: {rubric}

SCENARIO:
{p}

ANSWER:
{a}

Reply with exactly two lines:
VERDICT: PASS or FAIL
REASON: <one sentence citing the deciding part of the answer>"""


def judge(sc, ans):
    if "want" in sc:
        m = re.search(r"CHOICE:\**\s*\**\s*([A-C])", ans)
        if not m or m.group(1) != sc["want"]:
            return "FAIL", f"choice {m.group(1) if m else 'none'} != {sc['want']}"
        if sc["id"] != "S8-launch":
            return "PASS", "choice"
    txt = ""
    for _ in range(3):
        txt = chat("opus", [{"role": "user", "content": JUDGE.format(rubric=sc["rubric"], p=sc["p"], a=ans)}], max_tokens=1000)["content"] or ""
        if re.search(r"VERDICT:\s*(PASS|FAIL)", txt):
            break
    else:
        return "ERROR", "judge gave no verdict"
    v = "PASS" if re.search(r"VERDICT:\s*PASS", txt) else "FAIL"
    r = re.search(r"REASON:\s*(.*)", txt)
    return v, (r.group(1).strip() if r else txt.strip()[:200])


def main():
    arm, skill_dir = sys.argv[1], pathlib.Path(sys.argv[2]).resolve()
    reps = {"opus": 5, "astra": 3}
    only = None
    for a in sys.argv[3:]:
        if a.startswith("--reps="):
            reps = {k: int(v) for k, v in (x.split("=") for x in a[7:].split(","))}
        if a.startswith("--only="):
            only = set(a[7:].split(","))
    (HERE / "out" / arm).mkdir(parents=True, exist_ok=True)
    system = build_system(skill_dir)
    scs = [s for s in S if not only or s["id"] in only]
    jobs = [(sc, m, r) for sc in scs for m, n in reps.items() for r in range(n)]
    with cf.ThreadPoolExecutor(12) as ex:
        res = list(ex.map(lambda j: run_one(arm, skill_dir, j[0], j[1], j[2], system), jobs))
    print("runs:", sum(1 for _, s in res if s == "ok"), "new,", sum(1 for _, s in res if s == "cached"), "cached")

    jpath = HERE / "out" / arm / "judged.json"
    judged = json.loads(jpath.read_text()) if jpath.exists() else {}
    todo = [p for p, _ in res if p.name not in judged or judged[p.name]["verdict"] == "ERROR"]

    def do(p):
        d = json.loads(p.read_text())
        sc = next(s for s in S if s["id"] == d["id"])
        v, why = judge(sc, d["answer"])
        return p.name, {"verdict": v, "why": why, "reads": d["reads"], "model": d["model"], "id": d["id"]}
    with cf.ThreadPoolExecutor(12) as ex:
        for k, v in ex.map(do, todo):
            judged[k] = v
    jpath.write_text(json.dumps(judged, indent=1, sort_keys=True))

    rows = {}
    for k, v in judged.items():
        if only and v["id"] not in only:
            continue
        rows.setdefault(v["id"], {}).setdefault(v["model"], []).append(v["verdict"] == "PASS")
    tot = [0, 0]
    for sid in [s["id"] for s in scs]:
        cells = []
        for m in reps:
            x = rows.get(sid, {}).get(m, [])
            cells.append(f"{m} {sum(x)}/{len(x)}")
            tot[0] += sum(x); tot[1] += len(x)
        print(f"{sid:18} " + "  ".join(cells))
    print(f"TOTAL {tot[0]}/{tot[1]}")


if __name__ == "__main__":
    main()
