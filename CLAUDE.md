# CLAUDE.md

For a Claude session starting work in this repository. What railroad is and
why: [README.md](README.md). How to use it: the `railroad` skill.

## Which skill to load

- **`railroad`** (`.claude/skills/railroad/SKILL.md`, manual in
  `reference.md` beside it) — before changing behaviour, writing examples, or
  touching docs. Both files ship to users; keep them true to the code on
  `main`.
- **`bun-route`** (`.claude/skills/bun-route/`) — Bun HTML routes and
  `Bun.WebView` test patterns.
- **`/publish`** (`.claude/commands/publish.md`) — the release procedure,
  shared with delta and eta. Only run it when asked to release. npm publishing
  happens in CI (`.github/workflows/publish.yml`) on a published GitHub
  release; never publish by hand.

## Commands and gates

```sh
bun install              # dev deps only; bun.lock is committed
bun run check            # tsc --noEmit: strict, noUncheckedIndexedAccess, jsx: react
bun run check:consumer   # tsc over tests/consumer-types/ as a consumer compiles
bun test --coverage      # unit suite (happy-dom) + coverage table
bun run test:webview     # real-browser suite, by explicit path
```

The release gate is `bun run check && bun run check:consumer && bun test --coverage`.
CI (`.github/workflows/`) also runs `bun run test:webview` on its own step,
because bare `bun test` can drop files under `tests/` from discovery — never
take the bare count as proof the browser tests ran.

`check:consumer` compiles `tests/consumer-types/app.tsx` under the config the
README's example uses (`jsx: react-jsx`, `jsxImportSource`, `strict`, **no
`@types/bun`**). It is the only gate on the automatic JSX runtime path users
compile against.

Bun only: `bun`, `bunx`, `bun run`. Coverage has no enforced threshold; don't
let lines a change touches go uncovered. CI installs with `--frozen-lockfile`,
so after a dependency change run `bun install` and commit `bun.lock`.

## Where the contracts live

- **The JSDoc header of each source file** is the authoritative API. Read it
  before changing behaviour, and update it with the behaviour.

  | File | Exports | Depends on |
  |---|---|---|
  | `signals.ts` | `signal` `computed` `effect` `batch` `untrack` `Signal` `trackDispose` `pushDisposeScope` `popDisposeScope` `hasActiveDisposeScope` | — |
  | `jsx.ts` | `createElement` `Fragment` `when` `list` `mount` (and `adoptIntoSvg`, internal: for `routes.ts`) | signals |
  | `routes.ts` | `routes` `route` `navigate` `matchRoute` | signals, jsx (SVG adoption only; loads without a DOM) |
  | `shared.ts` | `key` `provide` `inject` `tryInject` `clearProviders` | — |
  | `logger.ts` | `createLogger` `setLogLevel` `getLogLevel` `loggedRequest` | — |
  | `index.ts` | the public surface | all of the above |
  | `jsx-runtime.ts` / `jsx-dev-runtime.ts` | `jsx` `jsxs` `jsxDEV` `Fragment`, the `JSX` namespace | jsx |

- **Tests pin the behaviour.** `signals.test.ts`, `jsx.test.tsx`,
  `routes.test.ts`, `shared.test.ts`, `logger.test.ts` per module;
  `fixes.test.tsx` holds one regression test per fixed bug — add yours there.
  `tests/webview.test.ts` drives `tests/server.ts` + `tests/fixtures/` in a
  real browser.
- **`CHANGELOG.md`** — Keep a Changelog. Add to `## [Unreleased]` as work
  lands, breaking changes first, each with how to move across. `/publish`
  promotes it.

## Invariants that must not break

- **Zero runtime dependencies; TypeScript source, no build step.** Imports are
  extensionless (`moduleResolution: "bundler"`). Nothing may reference a
  Bun ambient type (`globalThis.Bun`, `Bun.*`) without a cast — consumers
  compile railroad's source without `@types/bun`.
- **The dispose stack stays balanced.** Every `pushDisposeScope()` is popped
  on every path, throws included (`try/finally`), and never across an
  `await`. An imbalance corrupts every later scope.
- **Every `effect()`/`computed()` run is an owner scope.** What the body
  creates is disposed before the next run and on dispose.
- **Components run once.** A Signal or a function child/prop (other than `ref`
  and `on*`) is reactive; anything else is applied once. `on*` must be a
  function (non-function warns, attaches nothing).
- **`when()` and `list()` render synchronously**, keep their content between
  bracket comments, and never rebuild after disposal (the `disposed` latch).
  Outside a dispose scope they warn.
- **Propagation is glitch-free**: topologically ordered, each listener at most
  once per settled pass; a true cycle throws.
- **SVG tags get their namespace at creation.** Only `a`, `script`, `style`,
  `title` are adopted on append, and adoption disposes the old element's prop
  effects before re-applying them.
- **Async components and async route handlers resolve to a thunk**, run under
  a scope railroad owns.
- **`routes()` dispose is idempotent** and releases the shared `hashchange`
  refcount exactly once.
- Conventions in code and docs: HTML-flavoured JSX (`class`, `onclick`); no
  `.get()` in JSX children.

## Docs

- `README.md` is for someone deciding whether to use railroad: the pitch, one
  example that runs, what it pairs with, where to go next. Keep it short, and
  run the example if you change it.
- The manual is `.claude/skills/railroad/reference.md`; the checklist of what
  bites is `SKILL.md`. Don't copy either into this file or the README.
- Skills carry `version:` in frontmatter. Leave the number alone; `/publish`
  stamps it.

## The Claude Code web sandbox

Locally nothing is needed. In the web sandbox (`CLAUDE_CODE_REMOTE=true`) the
SessionStart hook `.claude/hooks/session-start.sh` (wired in
`.claude/settings.json`) upgrades Bun to ≥ 1.3.12, runs `bun install`, and
stages a headless Chromium from the `@sparticuz/chromium` npm tarball with a
`--no-sandbox` launch shim at `BUN_CHROME_PATH`, because the browser download
hosts (`cdn.playwright.dev`, `googlechromelabs.github.io`, `dl.google.com`,
`storage.googleapis.com`) are blocked there while npm and GitHub are not.
The hook's comments explain each step. Unit tests need none of it.
