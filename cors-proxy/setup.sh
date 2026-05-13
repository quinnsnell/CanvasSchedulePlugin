#!/usr/bin/env bash
# Cloudflare Worker setup for the iCal subscription feed.
#
# What this does:
#   1. Verifies wrangler is installed and you're logged in
#   2. Creates the ICAL_KV namespace (idempotent)
#   3. Patches wrangler.toml with the binding (idempotent)
#   4. Generates a random UPLOAD_SECRET, stores it as a worker secret,
#      and prints it for you to paste into the planner Setup panel
#   5. Deploys the worker
#
# Re-run safe: existing KV is reused, but a fresh secret is generated
# on every run unless you pass --keep-secret.

set -euo pipefail

cd "$(dirname "$0")"

KEEP_SECRET=false
for arg in "$@"; do
  case "$arg" in
    --keep-secret) KEEP_SECRET=true ;;
    -h|--help)
      sed -n '2,18p' "$0" | sed 's/^# \?//'
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

# ── Upload secret ──────────────────────────────────────────────

if $KEEP_SECRET && wrangler secret list 2>/dev/null | grep -q '"name": *"UPLOAD_SECRET"'; then
  echo "UPLOAD_SECRET already set — keeping (--keep-secret)"
  SECRET=""
else
  # 32 url-safe bytes
  SECRET=$(python3 -c 'import secrets; print(secrets.token_urlsafe(32))' 2>/dev/null \
    || openssl rand -base64 32 | tr -d '=+/' | cut -c1-43)
  echo "Setting UPLOAD_SECRET…"
  echo "$SECRET" | wrangler secret put UPLOAD_SECRET
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
if [[ -n "$SECRET" ]]; then
  echo "Upload secret (paste into the planner Setup panel under"
  echo "  'Calendar upload secret'):"
  echo
  echo "  $SECRET"
  echo
  echo "Then click Publish in the planner. Students subscribe to:"
  [[ -n "$WORKER_URL" ]] && echo "  $WORKER_URL/calendar/<canvas-host>-<courseId>.ics"
fi
echo "──────────────────────────────────────────────────────────"
