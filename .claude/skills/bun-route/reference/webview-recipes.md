# `Bun.WebView` recipes

```ts
// Poll: the missing waitForFunction
async function waitFor<T>(fn: () => Promise<T> | T, pred: (v: T) => boolean, ms = 3000): Promise<T> {
  const start = Date.now();
  while (Date.now() - start < ms) {
    const v = await fn();
    if (pred(v)) return v;
    await Bun.sleep(50);
  }
  throw new Error("waitFor timed out");
}

// Wait for a WebSocket update to land in the DOM
const count = await waitFor(
  () => view.evaluate<number>("document.querySelectorAll('.row').length"),
  (n) => n >= 7,
);

// Several statements: wrap them so evaluate gets one expression
const text = await view.evaluate<string>(
  `Function("const el = document.querySelector('#x');" +
           "el.click();" +
           "return el.textContent;")()`,
);
```

- A multi-statement string passed to `evaluate` throws `SyntaxError: Unexpected token ';'`.
- Escape a double-quoted attribute selector inside `Function("…")` as `\\"`: `'g[data-id=\\"s1\\"]'`.
- Pointer drag (canvas, SVG): dispatch `pointerdown`, `pointermove`, `pointerup` from `evaluate`, built as `new PointerEvent(t, { bubbles: true, cancelable: true, clientX, clientY, pointerId: 1, pointerType: "mouse", isPrimary: true })` at the element's centre from `getBoundingClientRect()`.
- Wheel or zoom: dispatch `new WheelEvent("wheel", { bubbles: true, cancelable: true, deltaY: -400, clientX, clientY })`.
- Tests that share state (a file, a database, a document) assert deltas, not absolutes: read before the action, `waitFor` the change, compare `after - before`.

```ts
const before = JSON.parse(readFileSync(dataFile, "utf8")).shape;
// … drag by (+120, +80) …
const after = await waitFor(() => JSON.parse(readFileSync(dataFile, "utf8")).shape,
                            (s) => Math.abs(s.x - before.x - 120) < 1);
expect(after.x - before.x).toBeCloseTo(120, 0);
```

## Running the suite (Bun 1.3.13+)

- `--isolate`: each file in a fresh global, for route tests that leak global or DOM state.
- `--parallel[=N]`: files across workers; safe only when each file binds its own `port: 0` server and data path.
- `--shard=M/N`: split files across CI runners. `--changed`: only files whose imports touch your git changes.
