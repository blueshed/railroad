#!/usr/bin/env bash
#
# setup-webview.sh — provision a Chrome/Chromium backend for the Bun.WebView
# integration tests (tests/webview.test.ts) in a restricted-network Linux
# sandbox (e.g. Claude Code on the web).
#
# Why this exists
# ---------------
# tests/webview.test.ts drives a real headless browser via `Bun.WebView`
# (Bun >= 1.3.12). On macOS that's system WKWebView with zero setup; on Linux
# WebView speaks CDP to an installed Chrome/Chromium and finds it via
# $BUN_CHROME_PATH or by searching $PATH. The sandbox ships neither a browser
# nor an upgradeable apt chromium (Ubuntu's is a snap stub), and the usual
# browser CDNs (cdn.playwright.dev, googlechromelabs.github.io, dl.google.com,
# storage.googleapis.com) are blocked by the egress allowlist.
#
# The npm registry and GitHub *are* reachable, so we pull a real headless
# Chromium binary out of the `@sparticuz/chromium` npm tarball (the build is
# bundled inside the package, not fetched from a CDN), stage it under
# /opt/chromium, and wrap it in a shim that adds the flags a root-in-container
# Chromium needs (--no-sandbox etc).
#
# Usage
# -----
#   bash scripts/setup-webview.sh
#   export BUN_CHROME_PATH=/opt/chromium/chrome-shim.sh
#   bun test
#
# Idempotent: re-running is a no-op once /opt/chromium/chromium exists.
set -euo pipefail

DEST=/opt/chromium
SHIM="$DEST/chrome-shim.sh"

if [ -x "$DEST/chromium" ]; then
  echo "Chromium already staged at $DEST/chromium"
else
  # 1. apt's Ubuntu archive is allowed, but two preinstalled PPAs
  #    (deadsnakes, ondrej/php) 403 during `apt update` and abort it. Park them.
  for f in /etc/apt/sources.list.d/deadsnakes-ubuntu-ppa-*.sources \
           /etc/apt/sources.list.d/ondrej-ubuntu-php-*.sources; do
    [ -f "$f" ] && mv "$f" "$f.disabled" || true
  done

  # 2. Install the C/font/X libraries Chromium needs (apt only, no CDN).
  npx --yes playwright@latest install-deps chromium

  # 3. Pull the bundled Chromium build from npm (not a browser CDN).
  TMP="$(mktemp -d)"
  ( cd "$TMP" && npm pack @sparticuz/chromium >/dev/null && tar xzf sparticuz-chromium-*.tgz )

  # 4. Brotli-decompress the binary and unpack the swiftshader (software GL)
  #    libs alongside it, where Chromium resolves them relative to argv[0].
  mkdir -p "$DEST"
  node -e "const fs=require('fs'),z=require('zlib');fs.writeFileSync('$DEST/chromium',z.brotliDecompressSync(fs.readFileSync('$TMP/package/bin/chromium.br')))"
  chmod +x "$DEST/chromium"
  node -e "const fs=require('fs'),z=require('zlib');fs.writeFileSync('$TMP/swiftshader.tar',z.brotliDecompressSync(fs.readFileSync('$TMP/package/bin/swiftshader.tar.br')))"
  tar xf "$TMP/swiftshader.tar" -C "$DEST"
  rm -rf "$TMP"
fi

# 5. (Re)write the launch shim. Bun.WebView spawns this over a CDP pipe;
#    without --no-sandbox a root-owned Chromium aborts ("closed the pipe").
cat > "$SHIM" <<'EOF'
#!/bin/sh
exec /opt/chromium/chromium \
  --no-sandbox \
  --disable-dev-shm-usage \
  --disable-gpu \
  "$@"
EOF
chmod +x "$SHIM"

"$DEST/chromium" --version
echo
echo "Ready. Run the WebView tests with:"
echo "  export BUN_CHROME_PATH=$SHIM"
echo "  bun test"
