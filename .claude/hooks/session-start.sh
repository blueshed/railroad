#!/bin/bash
# SessionStart hook — provision the Claude Code web sandbox so the full
# `bun test` suite (incl. the Bun.WebView integration tests) runs.
#
# See CLAUDE.md › "Testing in the Claude Code web sandbox" for the why.
# Runs synchronously so dependencies and the browser are ready before the
# agent loop starts.
set -euo pipefail

# Web sandbox only — locally you already have Bun and a browser.
if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi

cd "$CLAUDE_PROJECT_DIR"

# 1. Bun.WebView needs Bun >= 1.3.12; the base image ships 1.3.11.
#    npm registry is reachable; upgrade only if we're below the floor.
need_bun_upgrade=0
if ! command -v bun >/dev/null 2>&1; then
  need_bun_upgrade=1
else
  ver="$(bun --version)"
  # 1.3.12 is the floor; treat anything sorting below it as too old.
  if [ "$(printf '%s\n1.3.12\n' "$ver" | sort -V | head -n1)" != "1.3.12" ]; then
    need_bun_upgrade=1
  fi
fi
[ "$need_bun_upgrade" = "1" ] && npm install -g bun@latest

# 2. Dev dependencies (prefer install over ci so the container cache is reused).
bun install

# 3. Stage a headless Chromium for Bun.WebView (idempotent).
bash scripts/setup-webview.sh

# 4. Persist the browser path for the whole session so `bun test` finds it.
echo 'export BUN_CHROME_PATH=/opt/chromium/chrome-shim.sh' >> "$CLAUDE_ENV_FILE"
