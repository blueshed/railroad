// Type-only fixture (never executed). It exercises the documented consumer
// surface so `tsc -p` here fails if any of it stops type-checking under a real
// downstream config. Imports come from the bare package name on purpose, so the
// root barrel (and thus logger.ts's env access) is type-checked without
// @types/bun present.
import {
  signal,
  computed,
  effect,
  when,
  list,
  mount,
  routes,
  route,
  navigate,
  key,
  provide,
  inject,
  createLogger,
} from "@blueshed/railroad";
import type { Dispose } from "@blueshed/railroad";

const count = signal(0);
const doubled = computed(() => count.get() * 2);
const label = count.map((n) => `count: ${n}`);
effect(() => void count.get());

type Row = { id: number; text: string };
const rows = signal<Row[]>([{ id: 1, text: "a" }]);

const STORE = key<{ name: string }>("store");
provide(STORE, { name: "x" });
void inject(STORE).name;

const log = createLogger("[consumer]");
log.info("typechecks");

function App() {
  return (
    <div class={label}>
      <span>{count}</span>
      <span>{doubled}</span>
      <span>{() => (count.get() > 5 ? "high" : "low")}</span>
      <ul>
        {/* bare-arrow keyFn — must infer `r` as Row, no annotation */}
        {list(rows, (r) => r.id, (r$) => (
          <li>{r$.map((r) => r.text)}</li>
        ))}
        {/* 4-arg keyed overload — options.equals must infer a/b as Row */}
        {list(rows, (r) => r.id, (r$) => (
          <li>{r$.map((r) => r.text)}</li>
        ), { equals: (a, b) => a.id === b.id && a.text === b.text })}
      </ul>
      {/* index-based overload — `item` is raw Row */}
      {list(rows, (item, i) => (
        <li>
          {i}: {item.text}
        </li>
      ))}
      {when(count.map((c) => c > 0), () => (
        <p>positive</p>
      ))}
    </div>
  );
}

const user = route<{ id: string }>("/users/:id");
void user.get();

const root = document.getElementById("root");
if (root) {
  const disposeApp: Dispose = mount(root, () => <App />);
  void disposeApp;
  routes(root, {
    "/": () => <App />,
    "/users/:id": (_p, params$) => {
      const span = document.createElement("span");
      effect(() => {
        span.textContent = params$.get().id ?? "";
      });
      return span;
    },
  });
}
navigate("/");
