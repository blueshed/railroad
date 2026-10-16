# Realtime

## Your own patch stream: mutate in place, `.touch()`

```tsx
import { signal, list, mount } from "@blueshed/railroad";

type Row = { id: number; text: string; done: boolean };
const rows = signal<Row[]>([]);

const ws = new WebSocket("/ws");
ws.onmessage = (ev) => {
  const row: Row = JSON.parse(ev.data);
  const known = rows.peek().find((r) => r.id === row.id);
  if (known) Object.assign(known, row);          // in place: no clone of the whole document
  else rows.peek().push(row);
  rows.touch();                                  // notify, same reference
};

mount(document.getElementById("root")!, () => (
  <ul>
    {list(rows, (r) => r.id, (row$) => (
      <li>
        <input type="checkbox" checked={row$.map((r) => r.done)} />
        {row$.map((r) => r.text)}
      </li>
    ), { equals: () => false })}
  </ul>
));
```

- Don't `.set({ ...doc.peek(), … })` a fresh clone per patch on a large document: mutate it, then `.touch()`. `.mutate(fn)` (clone, mutate, notify) is the safer middle ground for small ones.
- `{ equals: () => false }` is needed because an in-place patch re-delivers the same row reference, which `Object.is` swallows; the row's own `.map()`s still bail on unchanged values, so DOM writes stay minimal.
- A projection that returns the same reference (`doc.map((d) => d.settings)`) bails after `.touch()`: project to fresh values or pass `{ equals: () => false }`.

## `@blueshed/delta`: documents over one WebSocket

```tsx
import { provide, list, when } from "@blueshed/railroad";
import { connectWs, WS, openDoc } from "@blueshed/delta/client";

provide(WS, connectWs("/ws"));
interface BoardDoc { cards: Record<string, { id: number; title: string }> }
const doc = openDoc<BoardDoc>("board:1");          // in a component or at module level

function Board() {
  const cards = doc.data.map((d) => d ? Object.values(d.cards) : []);
  return when(doc.data, () => (
    <ul>{list(cards, (c) => c.id, (card$) => <li>{card$.map((c) => c.title)}</li>)}</ul>
  ), () => <p>loading…</p>);
}

await doc.send([{ op: "add", path: "/cards/7", value: { id: 7, title: "new card" } }]);
```

```ts
// server.ts: one Bun.serve hosts the page and the socket
import home from "./index.html";
import { createWs, registerDoc } from "@blueshed/delta/server";

const ws = createWs();
await registerDoc(ws, "board:1", { file: "./board.json", empty: { cards: {} } });
Bun.serve({ routes: { "/": home, [ws.path]: ws.upgrade }, websocket: ws.websocket });
```

- `doc.data` is a railroad `ReadonlySignal<T | null>`: it drops into JSX, `when()` and `list()` with no glue. Change the document with `doc.send(ops)`, never `doc.data.set()`.
- Delta gives a changed row a fresh object, so `list()` keeps its default `equals`.
- Never `openDoc()` inside an `effect()` body unless following a signal is the intent: the doc closes when the effect re-runs.
- `applyOpsToCollection` (`@blueshed/delta/dom-ops`) is for vanilla DOM; with railroad, use `list()`. Pick one.
- Where documents are kept (a JSON file, SQLite, Postgres on dzql, memory, an outside source) changes nothing here: one client. The `delta-doc` skill, installed with delta, has them.
- Two copies of railroad break this silently: [one-copy](one-copy.md).
