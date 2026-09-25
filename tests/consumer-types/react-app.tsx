// Type-only fixture (never executed) for `jsx: react` with
// `jsxFactory: createElement`: TypeScript finds the JSX types on the factory
// (createElement.JSX), so railroad needs no global JSX namespace. The
// expected error on GlobalElement below proves none is declared through any
// entry point that pulls in jsx.ts.
import { createElement, Fragment, signal, when, list, mount, routes } from "@blueshed/railroad";
import type { JSX } from "@blueshed/railroad";
import "@blueshed/railroad/jsx";
import "@blueshed/railroad/routes";
import "@blueshed/railroad/jsx-runtime";
import "@blueshed/railroad/jsx-dev-runtime";

// @ts-expect-error -- railroad declares no global JSX; import it as above
type GlobalElement = globalThis.JSX.Element;

const count = signal(0);
type Row = { id: number; text: string };
const rows = signal<Row[]>([{ id: 1, text: "a" }]);

async function AsyncProfile(props: { id: number }) {
  await Promise.resolve();
  return () => <div>{props.id}</div>;
}

function App(): JSX.Element {
  return (
    <>
      <div class={count.map((n) => `n${n}`)}>{count}</div>
      <ul>{list(rows, (r) => r.id, (r$) => <li>{r$.map((r) => r.text)}</li>)}</ul>
      {when(count, () => <p>positive</p>)}
      <AsyncProfile id={1} fallback={() => <p>loading</p>} />
    </>
  );
}

// railroad JSX is a DOM Node, not some other library's element
const node: Node = <App />;
void node;

const root = document.getElementById("root");
if (root) {
  mount(root, () => <App />);
  routes(root, { "/": () => <App /> });
}
