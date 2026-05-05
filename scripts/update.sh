#!/usr/bin/env bash
# ICEN auto-update: generate activity (always) + maybe rotate bulletin → render → commit & push.
# Use from cron: 0 9 */4 * * cd /home/tama/projects/natto-eradication && bash scripts/update.sh >> /var/log/icen.log 2>&1
set -euo pipefail

cd "$(dirname "$0")/.."
ROOT="$(pwd)"
TS="$(date '+%Y-%m-%d %H:%M:%S %Z')"
echo "─── ICEN update @ ${TS} ───"

# Load GEMINI_API_KEY from agent-team .env if present
if [[ -z "${GEMINI_API_KEY:-}" && -f /home/tama/ai-agent-team/.env ]]; then
  set -a
  # shellcheck disable=SC1091
  source /home/tama/ai-agent-team/.env
  set +a
fi
: "${GEMINI_API_KEY:?GEMINI_API_KEY is required (export it or set in /home/tama/ai-agent-team/.env)}"

DECISION="$(python3 scripts/scheduler.py)"
echo "scheduler decision: ${DECISION}"

case "$DECISION" in
  annual)
    python3 scripts/generate_activity.py --mode=annual
    python3 scripts/generate_bulletin.py
    ;;
  regular)
    python3 scripts/generate_activity.py --mode=regular
    if (( RANDOM % 2 == 0 )); then
      python3 scripts/generate_bulletin.py
    else
      echo "skipped bulletin rotation this run"
    fi
    ;;
  skip)
    # 7% chance to refresh just the ticker even on quiet days
    if (( RANDOM % 100 < 7 )); then
      python3 scripts/generate_bulletin.py
    else
      echo "nothing to do today"
      exit 0
    fi
    ;;
  *)
    echo "unknown scheduler output: ${DECISION}" >&2
    exit 1
    ;;
esac

python3 scripts/render.py

if [[ -z "$(git status --porcelain)" ]]; then
  echo "no changes — skipping commit"
  exit 0
fi

LATEST="$(python3 - <<'PY'
import json, pathlib
data = json.loads(pathlib.Path("data/activities.json").read_text(encoding="utf-8"))
e = data["events"][-1]
print(f'{e["date"]} {e["title"]}')
PY
)"

git add data/activities.json data/bulletins.json index.html
git -c user.name="ICEN Secretariat" -c user.email="ly.renum@gmail.com" \
  commit -m "communiqué: ${LATEST}" -m "Automated update via scripts/update.sh"
git push origin HEAD
echo "─── done ───"
