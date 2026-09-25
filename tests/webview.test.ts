// Bun.WebView integration tests for @blueshed/railroad.
// Spins up the fixture app at tests/fixtures/app.tsx, opens it in a real
// headless browser, and asserts on rendered DOM and reactive behavior.
//
// IMPORTANT: this test file is NOT preloaded with happy-dom. It runs against
// a real browser via Bun.WebView, so the global `document`/`window` from
// happy-dom (registered in happy-dom.setup.ts) must NOT interfere. It doesn't:
// the WebView is a separate process that talks via IPC.

import { test, expect, beforeAll, afterAll, describe, setDefaultTimeout } from "bun:test";
import { startServer } from "./server";

// Real-browser tests pay a cold Chrome/CDP launch on the first test (slow on CI
// Linux runners), which can blow Bun's default 5s per-test timeout. Give the
// whole file generous headroom — these are integration tests, not unit tests.
setDefaultTimeout(30_000);

let server: Awaited<ReturnType<typeof startServer>>["server"];
let url: string;

beforeAll(async () => {
  const started = await startServer({ port: 0 });
  server = started.server;
  url = server.url.href;
});

afterAll(() => {
  server?.stop(true);
});

async function waitFor<T>(
  fn: () => Promise<T> | T,
  pred: (v: T) => boolean,
  ms = 10000,
): Promise<T> {
  const start = Date.now();
  let last: T;
  while (Date.now() - start < ms) {
    last = await fn();
    if (pred(last)) return last;
    await Bun.sleep(50);
  }
  throw new Error(`waitFor timed out; last value: ${JSON.stringify(last!)}`);
}

async function navHash(view: Bun.WebView, hash: string) {
  // Drive client-side navigation by setting location.hash, then yield so the
  // hashchange listener inside routes() runs.
  await view.evaluate(`(location.hash = ${JSON.stringify(hash)})`);
  await Bun.sleep(80);
}

// Typed shortcuts — view.evaluate<T = unknown> isn't tight enough for
// bun:test's expect() overloads. Specifying the return type at the call
// site avoids `unknown`-vs-string overload-resolution failures.
const evalStr = (view: Bun.WebView, script: string) => view.evaluate<string | null>(script);
const evalNum = (view: Bun.WebView, script: string) => view.evaluate<number>(script);
const evalBool = (view: Bun.WebView, script: string) => view.evaluate<boolean>(script);

// On Linux, Bun.WebView drives an installed Chrome/Chromium ($BUN_CHROME_PATH or
// $PATH). With none, e.g. a fresh sandbox, the suite is skipped and says so, so
// `bun test` stays a unit gate there. Never in CI, where no browser must fail.
const noBrowser =
  !process.env.CI &&
  process.platform === "linux" &&
  !process.env.BUN_CHROME_PATH &&
  !["google-chrome", "google-chrome-stable", "chromium", "chromium-browser", "chrome"].some((n) => Bun.which(n));
if (noBrowser) {
  console.warn("[webview.test] no Chrome/Chromium found (set BUN_CHROME_PATH): the browser tests are skipped");
}

describe.skipIf(noBrowser)("Bun.WebView — railroad fixture app", () => {
  test("home route mounts and shows DI greeting + reactive count", async () => {
    await using view = new Bun.WebView({ width: 800, height: 600 });
    await view.navigate(url);

    // Wait for client mount.
    const greet = await waitFor(
      () => evalStr(view, `document.querySelector('[data-testid=home-greet]')?.textContent`),
      (v) => typeof v === "string" && v.length > 0,
    );
    expect(greet).toBe("hi world");

    // Count starts at 0, doubled at 0.
    expect(await evalStr(view, `document.querySelector('[data-testid=count]').textContent`)).toBe("0");
    expect(await evalStr(view, `document.querySelector('[data-testid=doubled]').textContent`)).toBe("0");

    // Click +1 three times — count should become 3, doubled 6.
    await view.click("[data-testid=inc]");
    await view.click("[data-testid=inc]");
    await view.click("[data-testid=inc]");
    await waitFor(
      () => evalStr(view, `document.querySelector('[data-testid=count]').textContent`),
      (v) => v === "3",
    );
    expect(await evalStr(view, `document.querySelector('[data-testid=doubled]').textContent`)).toBe("6");

    // Click -1 once — count 2, doubled 4.
    await view.click("[data-testid=dec]");
    await waitFor(
      () => evalStr(view, `document.querySelector('[data-testid=count]').textContent`),
      (v) => v === "2",
    );
    expect(await evalStr(view, `document.querySelector('[data-testid=doubled]').textContent`)).toBe("4");
  });

  test("keyed list — add, remove, rename preserve identity", async () => {
    await using view = new Bun.WebView({ width: 800, height: 600 });
    await view.navigate(url);
    await waitFor(
      () => evalBool(view, `document.querySelector('[data-testid=to-list]') != null`),
      (v) => v === true,
    );
    await navHash(view, "#/list");

    await waitFor(
      () => evalBool(view, `document.querySelector('[data-route=list]') != null`),
      (v) => v === true,
    );

    expect(await evalNum(view,
      `document.querySelectorAll('[data-testid=rows] li').length`,
    )).toBe(2);

    // Add — should now have 3 rows. The first two must keep their nodes
    // (keyed identity preserved). We tag the first row to detect re-creation.
    await view.evaluate(
      `Function("document.querySelector('[data-testid=row-1]').setAttribute('data-marker','keep'); return true")()`,
    );
    await view.click("[data-testid=add]");
    await waitFor(
      () => evalNum(view, `document.querySelectorAll('[data-testid=rows] li').length`),
      (n) => n === 3,
    );
    expect(await evalStr(view,
      `document.querySelector('[data-testid=row-1]').getAttribute('data-marker')`,
    )).toBe("keep");

    // Rename first — same node, new text.
    await view.click("[data-testid=rename-first]");
    await waitFor(
      () => evalStr(view, `document.querySelector('[data-testid=row-1]').textContent`),
      (v) => v === "alpha!",
    );
    expect(await evalStr(view,
      `document.querySelector('[data-testid=row-1]').getAttribute('data-marker')`,
    )).toBe("keep");

    // Remove first — row-1 gone, row-2 still present with its identity.
    await view.evaluate(
      `Function("document.querySelector('[data-testid=row-2]').setAttribute('data-marker','two'); return true")()`,
    );
    await view.click("[data-testid=remove-first]");
    await waitFor(
      () => evalBool(view, `document.querySelector('[data-testid=row-1]') == null`),
      (v) => v === true,
    );
    expect(await evalStr(view,
      `document.querySelector('[data-testid=row-2]').getAttribute('data-marker')`,
    )).toBe("two");

    // Clear — when() should reveal "empty!".
    await view.click("[data-testid=clear]");
    await waitFor(
      () => evalStr(view, `document.querySelector('[data-testid=empty]')?.textContent`),
      (v) => v === "empty!",
    );
    expect(await evalNum(view,
      `document.querySelectorAll('[data-testid=rows] li').length`,
    )).toBe(0);
  });

  test("keyed list — a reorder leaves focus in a row that didn't move", async () => {
    await using view = new Bun.WebView({ width: 800, height: 600 });
    await view.navigate(url);
    await waitFor(
      () => evalBool(view, `document.querySelector('[data-testid=to-list]') != null`),
      (v) => v === true,
    );
    await navHash(view, "#/list");
    await view.click("[data-testid=add]"); // rows 1, 2, 3
    await waitFor(() => evalNum(view, `document.querySelectorAll('[data-testid=rows] li').length`), (n) => n === 3);
    // Focus row 2's input, then move the last row to the front (a JS click keeps focus).
    const focused = await evalStr(view, `(() => {
      document.querySelector('[data-testid=input-2]').focus();
      document.querySelector('[data-testid=rotate]').click();
      return document.activeElement.getAttribute('data-testid');
    })()`);
    expect(await evalStr(view,
      `[...document.querySelectorAll('[data-testid=rows] li')].map(li => li.dataset.testid).join(',')`,
    )).toBe("row-3,row-1,row-2");
    expect(focused).toBe("input-2");
  });

  test("hash navigation + params$ reactivity (no remount)", async () => {
    await using view = new Bun.WebView({ width: 800, height: 600 });
    await view.navigate(url);
    await waitFor(
      () => evalBool(view, `document.querySelector('[data-testid=to-users]') != null`),
      (v) => v === true,
    );
    await navHash(view, "#/users/42");

    await waitFor(
      () => evalStr(view, `document.querySelector('[data-testid=user-id]')?.textContent`),
      (v) => v === "42",
    );

    // Mark the section so we can prove no remount on params change.
    await view.evaluate(
      `Function("document.querySelector('[data-route=users]').setAttribute('data-marker','same'); return true")()`,
    );
    await view.click("[data-testid=next-user]");
    await waitFor(
      () => evalStr(view, `document.querySelector('[data-testid=user-id]')?.textContent`),
      (v) => v === "99",
    );
    expect(await evalStr(view,
      `document.querySelector('[data-route=users]').getAttribute('data-marker')`,
    )).toBe("same");

    // Navigate back home — section is gone (different pattern → teardown).
    await view.click("[data-testid=back-home]");
    await waitFor(
      () => evalBool(view, `document.querySelector('[data-route=users]') == null`),
      (v) => v === true,
    );
    expect(await evalBool(view,
      `document.querySelector('[data-route=home]') != null`,
    )).toBe(true);
  });

  test("navigate() is current as it returns, and an encoded path notifies once", async () => {
    await using view = new Bun.WebView({ width: 800, height: 600 });
    await view.navigate(url);
    await waitFor(
      () => evalBool(view, `document.querySelector('[data-testid=to-users]') != null`),
      (v) => v === true,
    );
    await navHash(view, "#/users/42");
    await waitFor(
      () => evalStr(view, `document.querySelector('[data-testid=param-runs]')?.textContent`),
      (v) => v === "1",
    );
    await view.click("[data-testid=nav-encoded]");
    // What the page showed as navigate() returned, before any hashchange.
    expect(await evalStr(view,
      `document.querySelector('[data-testid=nav-encoded]').dataset.shown`,
    )).toBe("a b");
    await Bun.sleep(150); // the hashchange has landed
    expect(await evalStr(view, `location.hash`)).toBe("#/users/a%20b");
    expect(await evalStr(view,
      `document.querySelector('[data-testid=param-runs]').textContent`,
    )).toBe("2"); // the hashchange set the same string: no second notify
  });

  test("SVG renders with correct namespace and reactive attribute", async () => {
    await using view = new Bun.WebView({ width: 800, height: 600 });
    await view.navigate(url);
    await waitFor(
      () => evalBool(view, `document.querySelector('[data-testid=to-svg]') != null`),
      (v) => v === true,
    );
    await navHash(view, "#/svg");

    await waitFor(
      () => evalBool(view, `document.querySelector('[data-testid=circle]') != null`),
      (v) => v === true,
    );

    // Namespace check — adopted SVG must be in the SVG namespace.
    expect(await evalStr(view,
      `document.querySelector('[data-testid=circle]').namespaceURI`,
    )).toBe("http://www.w3.org/2000/svg");

    // Reactive attribute starts at 50.
    expect(await evalStr(view,
      `document.querySelector('[data-testid=circle]').getAttribute('cx')`,
    )).toBe("50");

    // Click move twice — cx should advance by 20.
    await view.click("[data-testid=move]");
    await view.click("[data-testid=move]");
    await waitFor(
      () => evalStr(view, `document.querySelector('[data-testid=circle]').getAttribute('cx')`),
      (v) => v === "70",
    );

    // camelCase adoption: the browser must see a REAL SVGLinearGradientElement
    // (a lowercased <lineargradient> would be SVG-namespace but unrecognised).
    expect(await evalBool(view,
      `document.querySelector('[data-testid=grad]') instanceof SVGLinearGradientElement`,
    )).toBe(true);

    // foreignObject: a real SVGForeignObjectElement whose children stay HTML.
    expect(await evalBool(view,
      `document.querySelector('[data-testid=fo]') instanceof SVGForeignObjectElement`,
    )).toBe(true);
    expect(await evalStr(view,
      `document.querySelector('[data-testid=fo-html]').namespaceURI`,
    )).toBe("http://www.w3.org/1999/xhtml");
  });

  test("async route resolves and renders", async () => {
    await using view = new Bun.WebView({ width: 800, height: 600 });
    await view.navigate(url);
    await waitFor(
      () => evalBool(view, `document.querySelector('[data-testid=to-slow]') != null`),
      (v) => v === true,
    );
    await navHash(view, "#/slow");

    // Handler resolves after 100ms — wait for it.
    const text = await waitFor(
      () => evalStr(view, `document.querySelector('[data-testid=slow-loaded]')?.textContent`),
      (v) => v === "loaded",
    );
    expect(text).toBe("loaded");
  });
});
