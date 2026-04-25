// Bun.WebView integration tests for @blueshed/railroad.
// Spins up the fixture app at tests/fixtures/app.tsx, opens it in a real
// headless browser, and asserts on rendered DOM and reactive behavior.
//
// IMPORTANT: this test file is NOT preloaded with happy-dom. It runs against
// a real browser via Bun.WebView, so the global `document`/`window` from
// happy-dom (registered in happy-dom.setup.ts) must NOT interfere. It doesn't:
// the WebView is a separate process that talks via IPC.

import { test, expect, beforeAll, afterAll, describe } from "bun:test";
import { startServer } from "./server";

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
  ms = 3000,
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

describe("Bun.WebView — railroad fixture app", () => {
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
