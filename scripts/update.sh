#!/usr/bin/env bash
# ICEN auto-update: generate activity (always) + maybe rotate bulletin → render → commit & push.
# Use from cron: 0 9 */4 * * cd ~/icen && bash scripts/update.sh >> /var/log/icen.log 2>&1
set -euo pipefail

cd "$(dirname "$0")/.."
ROOT="$(pwd)"
TS="$(date '+%Y-%m-%d %H:%M:%S %Z')"
echo "─── ICEN update @ ${TS} ───"

# Load secrets from ICEN_ENV_FILE (default: ~/.icen.env) if present
ICEN_ENV_FILE="${ICEN_ENV_FILE:-$HOME/.icen.env}"
if [[ -z "${GEMINI_API_KEY:-}" && -f "${ICEN_ENV_FILE}" ]]; then
  set -a
  # shellcheck disable=SC1091
  source "${ICEN_ENV_FILE}"
  set +a
fi
: "${GEMINI_API_KEY:?GEMINI_API_KEY is required (export it or set in \${ICEN_ENV_FILE})}"

DECISION="$(python3 scripts/scheduler.py)"
echo "scheduler decision: ${DECISION}"

# Track which content was newly generated this run, for X auto-post.
GENERATED_ACTIVITY=0
GENERATED_BULLETIN=0

case "$DECISION" in
  annual)
    python3 scripts/generate_activity.py --mode=annual && GENERATED_ACTIVITY=1
    python3 scripts/generate_bulletin.py && GENERATED_BULLETIN=1
    ;;
  regular)
    python3 scripts/generate_activity.py --mode=regular && GENERATED_ACTIVITY=1
    if (( RANDOM % 2 == 0 )); then
      python3 scripts/generate_bulletin.py && GENERATED_BULLETIN=1
    else
      echo "skipped bulletin rotation this run"
    fi
    ;;
  skip)
    # 7% chance to refresh just the ticker even on quiet days
    if (( RANDOM % 100 < 7 )); then
      python3 scripts/generate_bulletin.py && GENERATED_BULLETIN=1
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
python3 scripts/render_feed.py

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

git add data/activities.json data/bulletins.json data/evergreen_state.json index.html feed.xml
git -c user.name="ICEN Secretariat" -c user.email="tama831@users.noreply.github.com" \
  commit -m "communiqué: ${LATEST}" -m "Automated update via scripts/update.sh"
git push origin HEAD

# Auto-post to X (best-effort; failures don't break the pipeline).
# Requires ICEN_ADMIN_KEY in env; idempotency keys prevent double-posts.
if [[ -n "${ICEN_ADMIN_KEY:-}" ]]; then
  POSTED_TO_X=0
  if (( GENERATED_ACTIVITY )); then
    echo "─ posting activity to X ─"
    python3 scripts/post_x.py --kind=activity && POSTED_TO_X=1 || echo "X activity post failed (continuing)"
  fi
  if (( GENERATED_BULLETIN )); then
    echo "─ posting bulletin to X ─"
    python3 scripts/post_x.py --kind=bulletin && POSTED_TO_X=1 || echo "X bulletin post failed (continuing)"
  fi

  # On any other day, post one evergreen tweet with ~40% probability so the
  # account averages roughly one post every 2-3 days (mixed with the
  # less-frequent activity / bulletin posts above).
  if (( ! POSTED_TO_X )); then
    if (( RANDOM % 100 < 40 )); then
      echo "─ posting evergreen to X ─"
      python3 scripts/post_evergreen.py || echo "X evergreen post failed (continuing)"
    else
      echo "no X post today (quiet day)"
    fi
  fi
else
  echo "ICEN_ADMIN_KEY not set — skipping X auto-post"
fi

echo "─── done ───"
