#!/usr/bin/env bash
# Cloudflare Worker setup for the iCal subscription feed.
#
# What this does:
#   1. Verifies wrangler is installed and you're logged in
#   2. Creates the ICAL_KV namespace (idempotent)
#   3. Patches wrangler.toml with the binding (idempotent)
#   4. Deploys the worker
#
# No upload secret needed — PUT auth is per-professor via their Canvas
# PAT, validated by the worker against Canvas itself. Re-run safe.

set -euo pipefail

cd "$(dirname "$0")"

for arg in "$@"; do
  case "$arg" in
    -h|--help)
      sed -n '2,12p' "$0" | sed 's/^# \?//'
      exit 0
      ;;
  esac
done

# ── Preflight ──────────────────────────────────────────────────

if ! command -v wrangler >/dev/null 2>&1; then
  echo "ERROR: wrangler not installed. Try: npm install -g wrangler" >&2
  exit 1
fi

if ! wrangler whoami >/dev/null 2>&1; then
  echo "ERROR: not logged in. Run: wrangler login" >&2
  exit 1
fi

WORKER_NAME=$(awk -F' *= *' '/^name *=/ {gsub(/"/,"",$2); print $2; exit}' wrangler.toml)
if [[ -z "$WORKER_NAME" ]]; then
  echo "ERROR: could not read worker name from wrangler.toml" >&2
  exit 1
fi
echo "Worker: $WORKER_NAME"

# ── KV namespace ───────────────────────────────────────────────

if grep -q '^\[\[kv_namespaces\]\]' wrangler.toml && grep -q 'binding *= *"ICAL_KV"' wrangler.toml; then
  KV_ID=$(awk '/binding *= *"ICAL_KV"/{found=1} found && /^id *= *"/{gsub(/"/,"",$NF); print $NF; exit}' wrangler.toml)
  echo "KV binding already in wrangler.toml (id=$KV_ID) — reusing"
else
  echo "Creating KV namespace ICAL_KV…"
  # Try to find an existing namespace first to avoid duplicates
  KV_ID=$(wrangler kv:namespace list 2>/dev/null \
    | awk -v name="${WORKER_NAME}-ICAL_KV" '$0 ~ name {gsub(/[",]/,""); for (i=1;i<=NF;i++) if ($i=="\"id\":") print $(i+1)}' \
    | head -1 || true)

  if [[ -z "$KV_ID" ]]; then
    CREATE_OUT=$(wrangler kv:namespace create ICAL_KV 2>&1)
    KV_ID=$(echo "$CREATE_OUT" | awk -F'"' '/id *= *"/ {print $2; exit}')
    if [[ -z "$KV_ID" ]]; then
      echo "ERROR: could not parse KV id from wrangler output:" >&2
      echo "$CREATE_OUT" >&2
      exit 1
    fi
  fi

  echo "Adding binding to wrangler.toml (id=$KV_ID)…"
  cat >> wrangler.toml <<EOF

[[kv_namespaces]]
binding = "ICAL_KV"
id = "$KV_ID"
EOF
fi

# ── Deploy ─────────────────────────────────────────────────────

echo "Deploying…"
DEPLOY_OUT=$(wrangler deploy 2>&1)
echo "$DEPLOY_OUT" | tail -5
WORKER_URL=$(echo "$DEPLOY_OUT" | grep -oE 'https://[^ ]+\.workers\.dev' | head -1 || true)

# ── Summary ────────────────────────────────────────────────────

echo
echo "──────────────────────────────────────────────────────────"
echo "Done."
[[ -n "$WORKER_URL" ]] && echo "Worker URL:  $WORKER_URL"
echo
echo "Each professor just publishes from the planner — no secret to"
echo "share. The worker validates each upload against their Canvas PAT."
echo
echo "Students subscribe to:"
[[ -n "$WORKER_URL" ]] && echo "  $WORKER_URL/calendar/<canvas-host>-<courseId>.ics"
echo "──────────────────────────────────────────────────────────"
