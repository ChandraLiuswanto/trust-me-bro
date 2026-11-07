#!/usr/bin/env bash
# Report which skills Pi loads under each host, via RPC get_commands.
# Usage: bash tests/host-skills.sh [--assert]
#   --assert  exit non-zero unless host isolation holds.
set -u
ASSERT=${1:-}
PASEO_ONLY=(skill:pi-agents skill:sol-git-gud skill:paseo)
ORCA_ONLY=(skill:orca-agents skill:sol-git-gud-orca)
SHARED=(skill:web-scraping skill:writing-like-a-human)
fail=0

skills_for() { # $1 = label, rest = env assignments
  local label=$1; shift
  { echo '{"id":"1","type":"get_commands"}'; sleep 20; } |
    env -u PASEO_AGENT_ID -u PASEO_HOME -u ORCA_PANE_KEY -u PI_HOST_SKILLS "$@" \
      timeout 30 pi --mode rpc --no-session 2>"/tmp/host-skills-$label.err" |
    python3 -c '
import sys, json
for line in sys.stdin:
    try: d = json.loads(line)
    except ValueError: continue
    if d.get("command") == "get_commands":
        names = sorted(c["name"] for c in d["data"]["commands"] if c["source"] == "skill")
        print(" ".join(names)); break
'
}

# expect_set <label> <yes|no> <seen-count> <total> <name>
expect_set() {
  local label=$1 want=$2 seen=$3 total=$4 name=$5
  if [[ $want == yes && $seen -ne $total ]]; then fail=1; echo "  !! expected all $name skills"; fi
  if [[ $want == no && $seen -ne 0 ]]; then fail=1; echo "  !! $name skills leaked"; fi
}

check() { # $1 label, $2 expect paseo (yes/no), $3 expect orca (yes/no), rest env
  local label=$1 want_p=$2 want_o=$3; shift 3
  local got; got=$(skills_for "$label" "$@")
  local p=() o=() missing=() s
  for s in "${PASEO_ONLY[@]}"; do [[ " $got " == *" $s "* ]] && p+=("$s"); done
  for s in "${ORCA_ONLY[@]}"; do [[ " $got " == *" $s "* ]] && o+=("$s"); done
  for s in "${SHARED[@]}"; do [[ " $got " == *" $s "* ]] || missing+=("$s"); done
  printf '%-9s paseo=[%s] orca=[%s] shared-missing=[%s]\n' "$label" "${p[*]-}" "${o[*]-}" "${missing[*]-}"
  if [[ -z $got ]]; then echo "  !! no response (see /tmp/host-skills-$label.err)"; fail=1; return; fi
  expect_set "$label" "$want_p" ${#p[@]} ${#PASEO_ONLY[@]} Paseo
  expect_set "$label" "$want_o" ${#o[@]} ${#ORCA_ONLY[@]} Orca
  if [[ ${#missing[@]} -ne 0 ]]; then fail=1; echo "  !! shared skills missing"; fi
}

check plain    no  no
check paseo    yes no  PASEO_AGENT_ID=test
check orca     no  yes ORCA_PANE_KEY=test
check override yes no  PI_HOST_SKILLS=paseo
check both     yes yes PI_HOST_SKILLS=paseo,orca
check none     no  no  PASEO_AGENT_ID=test ORCA_PANE_KEY=test PI_HOST_SKILLS=none

[[ $ASSERT == --assert ]] && { ((fail)) && echo FAIL || echo PASS; exit $fail; }
exit 0
