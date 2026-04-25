import {
  createElement,
  Fragment,
  signal,
  computed,
  effect,
  routes,
  navigate,
  when,
  list,
  provide,
  inject,
  key,
} from "../../index";

// Suppress unused warnings — Fragment + effect imported for completeness.
void Fragment; void effect;

// === DI demo ===
type Greeter = { hello: (name: string) => string };
const GreeterKey = key<Greeter>("Greeter");
provide(GreeterKey, { hello: (n) => `hi ${n}` });

// === Home route ===
function Home() {
  const count = signal(0);
  const doubled = computed(() => count.get() * 2);
  const greeter = inject(GreeterKey);
  return (
    <section data-route="home">
      <h1 data-testid="home-greet">{greeter.hello("world")}</h1>
      <p>
        count: <span data-testid="count">{count}</span>
        {" / "}
        doubled: <span data-testid="doubled">{doubled}</span>
      </p>
      <button data-testid="inc" onclick={() => count.update((n) => n + 1)}>+1</button>
      <button data-testid="dec" onclick={() => count.update((n) => n - 1)}>-1</button>
      <a data-testid="to-list" href="#/list">list</a>
      <a data-testid="to-users" href="#/users/42">users</a>
      <a data-testid="to-svg" href="#/svg">svg</a>
      <a data-testid="to-slow" href="#/slow">slow</a>
    </section>
  );
}

// === Keyed list route ===
type Row = { id: number; text: string };
function ListPage() {
  const rows = signal<Row[]>([
    { id: 1, text: "alpha" },
    { id: 2, text: "beta" },
  ]);
  let nextId = 3;
  const addRow = () => rows.update((r) => [...r, { id: nextId++, text: `row${nextId - 1}` }]);
  const removeFirst = () => rows.update((r) => r.slice(1));
  const renameFirst = () =>
    rows.update((r) => r.length ? [{ ...r[0]!, text: r[0]!.text + "!" }, ...r.slice(1)] : r);
  const clear = () => rows.set([]);
  return (
    <section data-route="list">
      <h1>list</h1>
      <button data-testid="add" onclick={addRow}>add</button>
      <button data-testid="remove-first" onclick={removeFirst}>remove first</button>
      <button data-testid="rename-first" onclick={renameFirst}>rename first</button>
      <button data-testid="clear" onclick={clear}>clear</button>
      <ul data-testid="rows">
        {list(rows, (r: Row) => r.id, (r$) => (
          <li data-testid={`row-${r$.peek().id}`}>{r$.map((r) => r.text)}</li>
        ))}
      </ul>
      {when(
        rows.map((r) => r.length === 0),
        () => <p data-testid="empty">empty!</p>,
      )}
      <a data-testid="back-home" href="#/">home</a>
    </section>
  );
}

// === Users route — params$ reactivity ===
// The route handler form (params, params$) — render directly, not via JSX,
// so the reactive params$ signal is in scope.
function usersHandler(
  _p: Record<string, string>,
  params$: { get: () => Record<string, string> },
): Node {
  return (
    <section data-route="users">
      <h1>user</h1>
      <p>id: <span data-testid="user-id">{() => params$.get().id ?? ""}</span></p>
      <a data-testid="next-user" href="#/users/99">go to 99</a>
      <a data-testid="back-home" href="#/">home</a>
    </section>
  );
}

// === SVG route ===
function SvgPage() {
  const cx = signal(50);
  const move = () => cx.update((n) => n + 10);
  return (
    <section data-route="svg">
      <h1>svg</h1>
      <svg width="200" height="100" data-testid="svg">
        <circle data-testid="circle" cx={cx} cy="50" r="20" fill="red" />
      </svg>
      <button data-testid="move" onclick={move}>move</button>
      <a data-testid="back-home" href="#/">home</a>
    </section>
  );
}

// === Slow async route ===
function SlowPage(): Promise<Node> {
  return new Promise<Node>((resolve) => {
    setTimeout(() => {
      const el = (
        <section data-route="slow">
          <h1 data-testid="slow-loaded">loaded</h1>
          <a data-testid="back-home" href="#/">home</a>
        </section>
      ) as Node;
      resolve(el);
    }, 100);
  });
}

const root = document.getElementById("root")!;
routes(root, {
  "/": () => <Home />,
  "/list": () => <ListPage />,
  "/users/:id": usersHandler,
  "/svg": () => <SvgPage />,
  "/slow": () => SlowPage(),
});

// Eliminate unused-warning for navigate (re-exported for completeness).
void navigate;
