# CLAUDE.md

Guidance for Claude Code (and humans) working in this repository.

## What this is

`@blueshed/railroad` — the smallest reactive layer for Bun realtime apps:
signals, a real-DOM JSX runtime, a hash router, typed DI, and a logger. Zero
runtime dependencies, ~1KLOC. Each module is independent and importable on its
own (`@blueshed/railroad/signals`, `/jsx`, `/routes`, `/shared`).

| File | Exports | Depends on |
|---|---|---|
| `signals.ts` | `signal` `computed` `effect` `batch` `untrack` `Signal` | — |
| `jsx.ts` | `createElement` `Fragment` `when` `list` | signals |
| `routes.ts` | `routes` `route` `navigate` `matchRoute` | signals |
| `shared.ts` | `key` `provide` `inject` `tryInject` | — |
| `logger.ts` | `createLogger` `setLogLevel` `loggedRequest` | — |
| `index.ts` | re-exports the public surface | all of the above |
| `jsx-runtime.ts` / `jsx-dev-runtime.ts` | `jsx` `jsxs` `jsxDEV` `Fragment` | jsx |

Every source file has a JSDoc header that is the authoritative API reference —
read it before changing behaviour. `.claude/skills/railroad/SKILL.md` documents
the usage gotchas.

## Commands

```sh
bun install          # install dev deps
bun test             # full suite (unit + WebView integration)
bun run check        # bunx tsc --noEmit — strict, noUncheckedIndexedAccess
```

Unit tests run against happy-dom (preloaded via `bunfig.toml`). The integration
tests in `tests/webview.test.ts` drive a real headless browser via `Bun.WebView`
and need a one-time environment setup on Linux — see below.

## Testing in the Claude Code web sandbox

The default web sandbox could not run the WebView tests out of the box. Two
things had to be adapted; both are reproducible and do not change the library.

### 1. Bun version

`Bun.WebView` requires **Bun >= 1.3.12**. The image shipped 1.3.11, which made
all 5 WebView tests fail with `new Bun.WebView(...)` being `undefined is not a
constructor`. Upgrade via npm (the npm registry is reachable):

```sh
npm install -g bun@latest   # 1.3.14+ — provides Bun.WebView
```

### 2. A Chrome/Chromium backend

On Linux, `Bun.WebView` doesn't bundle a browser — it speaks CDP to an installed
Chrome/Chromium, located via `$BUN_CHROME_PATH` or a `$PATH` search. The sandbox
has no browser, Ubuntu's apt `chromium` is only a snap stub, and the usual
browser download hosts (`cdn.playwright.dev`, `googlechromelabs.github.io`,
`dl.google.com`, `storage.googleapis.com`) are blocked by the egress allowlist.

The npm registry and GitHub *are* reachable, so the binary comes from the
`@sparticuz/chromium` npm package, which bundles a real headless Chromium build
*inside the tarball* rather than fetching it from a CDN.
`scripts/setup-webview.sh` automates the whole thing:

```sh
bash scripts/setup-webview.sh
export BUN_CHROME_PATH=/opt/chromium/chrome-shim.sh
bun test          # 109 pass, 0 fail
```

What the script does:

1. Parks two preinstalled PPAs (deadsnakes, ondrej/php) that `403` and abort
   `apt update`, then installs Chromium's system libraries with
   `npx playwright install-deps chromium` (apt only — no CDN).
2. `npm pack @sparticuz/chromium`, brotli-decompresses `bin/chromium.br` into
   `/opt/chromium/chromium`, and unpacks the swiftshader (software GL) libs
   alongside it.
3. Writes `/opt/chromium/chrome-shim.sh`, a launcher that adds `--no-sandbox`
   `--disable-dev-shm-usage` `--disable-gpu`. The shim is what
   `BUN_CHROME_PATH` points at — without `--no-sandbox` a root-owned Chromium
   aborts at startup and Bun reports `Chrome process closed the pipe`.

Because the sandbox is ephemeral, `/opt/chromium` and the Bun upgrade do not
survive a fresh container — re-run the two steps above (or wire them into a
`SessionStart` hook) at the start of a session that needs the WebView tests.
The unit tests need none of this and run anywhere with `bun test`.

## Conventions

- HTML-flavoured JSX: `class` not `className`, `onclick` not `onClick`.
- Never call `.get()` in JSX children — pass the bare signal (`{count}`), a
  function child (`{() => ...}`), or `.map()`. See SKILL.md §1.
- Effects/computeds auto-dispose only inside a parent scope (component, route,
  `when`, `list`); a top-level `effect()` leaks unless you keep its disposer.
- TypeScript is strict with `noUncheckedIndexedAccess`. Keep `bun run check`
  clean.
- Publishing is release-driven: `.github/workflows/publish.yml` runs
  `bun test` + `bunx tsc --noEmit` then `npm publish --provenance` on a
  published GitHub release. Don't publish by hand.
