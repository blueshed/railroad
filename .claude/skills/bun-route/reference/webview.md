# Testing a route with `Bun.WebView`

```ts
// server.ts: an importable factory, so a test binds port 0
import indexHtml from "./index.html";

export interface StartOptions { port?: number /* and any data paths to inject */ }

export async function startServer(opts: StartOptions = {}) {
  const server = Bun.serve({
    port: opts.port ?? Number(process.env.PORT ?? 3000),
    routes: { "/": indexHtml },
    development: process.env.NODE_ENV !== "production" && { hmr: true, console: true },
  });
  return { server };
}

if (import.meta.main) {
  const { server } = await startServer();
  console.log(`Listening on ${server.url}`);
}
```

```ts
// tests/page.test.ts
import { test, expect, beforeAll, afterAll } from "bun:test";
import { startServer } from "../server";

let server: Awaited<ReturnType<typeof startServer>>["server"];

beforeAll(async () => { ({ server } = await startServer({ port: 0 })); });
afterAll(() => server?.stop(true));

test("a click shows the answer", async () => {
  await using view = new Bun.WebView({ width: 1024, height: 768 });
  await view.navigate(server.url.href);
  await view.click("#submit");
  expect(await view.evaluate<string>("document.querySelector('#out').textContent")).toBe("ok");
});
```

The methods and options are Bun's types (`Bun.WebView` in `@types/bun`); read them, not a table. Recipes for what it lacks: [webview-recipes](webview-recipes.md).

- Bun 1.3.12+ for `Bun.WebView`; 1.3.14+ for `clickCount`, the per-call `timeout` and the constructor's `console` and `dataStore`. Check `bun --version` and tell the user if theirs is older.
- No import or install; plain `bun test`, no `--browser` flag. macOS uses WKWebView; on Linux and Windows pass `backend: "chrome"`. Input is real OS events (`isTrusted: true`).
- `evaluate` takes one **expression**, not statements: wrap a body in `Function("…; return …;")()`.
- Always type `evaluate<string>(…)`: its default `unknown` makes `expect()` pick the wrong overload. Only JSON-serialisable values cross; no functions or Nodes.
- No `waitForSelector`, `waitForNavigation` or `waitForFunction`. Selector methods wait until the element is attached, visible, stable and unobscured (default 30000 ms), **not** enabled: wait for a disabled button to enable. Anything else (a WebSocket update, a file write): poll.
- `await` every call: one `navigate`, `evaluate`, screenshot or input at a time, or `ERR_INVALID_STATE`.
- `click(selector)` doesn't scroll: `scrollTo(selector)` first. `click(sel, { clickCount: 2 })` double-clicks.
- `type()` appends: clear the field in `evaluate` (set `value = ""`, dispatch `input`), then `click` and `type`.
- On macOS `view.title` is empty after the first `navigate`: read `document.title`.
- A fresh `await using view` per test; one browser process is shared, so a view is a cheap tab. A test needing a second window closes it in a `finally`.
- `dataStore: "ephemeral"` keeps cookies and storage from leaking between tests; `console: console` (or a callback) forwards or captures page logs.
- Use `server.url.href`, never a hard-coded `localhost:3000`; never start the server with a shell command in `beforeAll`.
- Give the factory a throwaway data path: `mkdtempSync(join(tmpdir(), "app-test-"))` in `beforeAll`, `rmSync(dir, { recursive: true, force: true })` in `afterAll`.
- `cdp(method, params)` (DevTools Protocol) works only on the `chrome` backend.
