// Regression tests for the review fix sets — each pins a bug found in a deep
// review (and several load-bearing invariants that previously had no test).
import { describe, test, expect, spyOn, beforeEach, afterEach } from "bun:test";
import { createElement, Fragment, when, list, mount } from "./jsx";
import {
  signal,
  computed,
  effect,
  batch,
  pushDisposeScope,
  popDisposeScope,
  trackDispose,
  hasActiveDisposeScope,
} from "./signals";
import type { ReadonlySignal } from "./signals";
import type { JSX } from "./jsx";
import { routes, route, navigate, matchRoute } from "./routes";
import { key, provide, inject, clearProviders } from "./shared";
import { createLogger, setLogLevel } from "./logger";

const SVG_NS = "http://www.w3.org/2000/svg";
const tick = () => new Promise<void>((r) => setTimeout(r, 0));
const flush = () => new Promise<void>((r) => queueMicrotask(() => r()));

function defer<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

// ============================================================ signals.ts

describe("signals: disposed-effect / depth-guard / dispose", () => {
  test("an effect disposed mid-batch does not run (batch == non-batch)", () => {
    const s = signal(0);
    let bRuns = 0;
    let disposeB: (() => void) | undefined;
    // A is registered first, so it runs first in the flush and disposes B.
    effect(() => { s.get(); if (disposeB) disposeB(); });
    disposeB = effect(() => { s.get(); bRuns++; });

    bRuns = 0;
    batch(() => { s.set(1); });
    expect(bRuns).toBe(0); // B was disposed by A before its queued run
  });

  test("MAX_EFFECT_DEPTH throws on a self-feeding effect", () => {
    const s = signal(0);
    expect(() => {
      effect(() => { const v = s.get(); if (v < 100000) s.set(v + 1); });
    }).toThrow(/Maximum effect depth/);
  });

  test("a deep-but-finite computed chain (300) completes — guard isn't 100", () => {
    const base = signal(0);
    let prev: ReadonlySignal<number> = base;
    for (let i = 0; i < 300; i++) {
      const p = prev;
      prev = computed(() => p.get() + 1);
    }
    expect(prev.get()).toBe(300);
    expect(() => base.set(1)).not.toThrow();
    expect(prev.get()).toBe(301);
  });

  test("dispose() shrinks the listener Set and is idempotent", () => {
    const s = signal(0);
    const d = effect(() => { s.get(); });
    expect((s as any).listeners.size).toBe(1);
    d();
    d(); // second call must be a safe no-op
    expect((s as any).listeners.size).toBe(0);
  });

  test("a throwing effect run does not strand subscriptions past dispose()", () => {
    const a = signal(0);
    const b = signal(0);
    // First run reads only a; the second run reads b and then throws, so the
    // dep-set swap must still happen or dispose() can never unsubscribe from b.
    const d = effect(() => {
      if (a.get() === 1) { b.get(); throw new Error("boom"); }
    });
    expect(() => a.set(1)).toThrow("boom");
    d();
    expect((a as any).listeners.size).toBe(0);
    expect((b as any).listeners.size).toBe(0);
  });

  test("batch(): an error thrown by fn() is not masked by a flush error", () => {
    const s = signal(0);
    // This effect throws during the flush; fn()'s own error must still win.
    effect(() => { if (s.get() > 0) throw new Error("flush boom"); });
    expect(() => {
      batch(() => {
        s.set(1);
        throw new Error("fn boom");
      });
    }).toThrow("fn boom");
  });
});

// ============================================================ jsx.ts

describe("jsx: SVG adoption / list / function-child / prop guards", () => {
  // when()/list() warn outside a dispose scope — bracket each test in one.
  beforeEach(() => { document.body.innerHTML = ""; pushDisposeScope(); });
  afterEach(() => { popDisposeScope()(); });

  test("adopted SVG element keeps exactly one reactive subscription", () => {
    const cls = signal("a");
    const svg = (
      <svg>
        <rect class={cls} data-testid="r" />
      </svg>
    ) as unknown as SVGElement;
    const rect = svg.querySelector("[data-testid=r]")!;
    expect(rect.namespaceURI).toBe(SVG_NS);
    // The discarded HTML-namespace element's effect was disposed during adoption,
    // so only the live SVG element's effect remains subscribed.
    expect((cls as any).listeners.size).toBe(1);
    cls.set("b");
    expect(rect.getAttribute("class")).toBe("b");
  });

  test("ref on an adopted SVG element ends with the SVG-namespace node", () => {
    const refs: Element[] = [];
    const svg = (
      <svg>
        <rect ref={(el: Element) => { refs.push(el); }} data-testid="r2" />
      </svg>
    ) as unknown as SVGElement;
    expect(svg.querySelector("[data-testid=r2]")!.namespaceURI).toBe(SVG_NS);
    expect(refs.length).toBeGreaterThan(0);
    expect(refs[refs.length - 1]!.namespaceURI).toBe(SVG_NS);
  });

  test("list() warns on duplicate keys", async () => {
    const warnSpy = spyOn(console, "warn").mockImplementation(() => {});
    const rows = signal([{ id: 1, t: "a" }, { id: 1, t: "b" }]);
    const ul = (
      <ul>{list(rows, (r) => r.id, (r$) => <li>{r$.map((r) => r.t)}</li>)}</ul>
    ) as HTMLElement;
    document.body.append(ul);
    await flush();
    expect(
      warnSpy.mock.calls.some((c) => String(c[0]).includes("duplicate keys")),
    ).toBe(true);
    warnSpy.mockRestore();
  });

  test("a function child returning a Node warns and renders as text", () => {
    const warnSpy = spyOn(console, "warn").mockImplementation(() => {});
    const div = createElement("div", null, () => document.createElement("span")) as HTMLElement;
    expect(
      warnSpy.mock.calls.some((c) => String(c[0]).includes("reactive child held a DOM Node")),
    ).toBe(true);
    expect(div.querySelector("span")).toBeNull(); // not inserted as an element
    warnSpy.mockRestore();
  });

  test("null/undefined signal value coerces to empty string, not 'null'", () => {
    const v = signal<string | null>(null);
    const input = createElement("input", { value: v }) as HTMLInputElement;
    expect(input.value).toBe("");
    v.set("hi");
    expect(input.value).toBe("hi");
    v.set(null);
    expect(input.value).toBe("");
  });

  test("when(): active branch effects die with the parent scope", async () => {
    const flag = signal(true);
    const inner = signal(0);
    let branchRuns = 0;

    pushDisposeScope();
    const node = when(flag, () => {
      const el = document.createElement("span");
      effect(() => { inner.get(); branchRuns++; });
      return el;
    });
    const dispose = popDisposeScope();

    document.body.append(node);
    await flush();
    expect(branchRuns).toBe(1);
    inner.set(1);
    expect(branchRuns).toBe(2);

    dispose(); // parent teardown must dispose the live branch too
    inner.set(2);
    expect(branchRuns).toBe(2);
    expect(document.body.querySelector("span")).toBeNull(); // nodes removed
  });

  test("camelCase SVG tags keep their case through adoption", () => {
    const svg = (
      <svg>
        <defs>
          <linearGradient id="g">
            <stop offset="0" stop-color="red" />
          </linearGradient>
        </defs>
      </svg>
    ) as unknown as SVGElement;
    const grad = svg.querySelector("#g")!;
    expect(grad.namespaceURI).toBe(SVG_NS);
    expect(grad.localName).toBe("linearGradient");
    expect(grad.querySelector("stop")!.namespaceURI).toBe(SVG_NS);
  });

  test("foreignObject keeps its case and its children stay HTML", () => {
    const svg = (
      <svg>
        <foreignObject width="100" height="100">
          <div class="html-island">hello</div>
        </foreignObject>
      </svg>
    ) as unknown as SVGElement;
    const fo = svg.querySelector("foreignObject")!;
    expect(fo.namespaceURI).toBe(SVG_NS);
    expect(fo.localName).toBe("foreignObject");
    const div = fo.querySelector("div")!;
    expect(div.namespaceURI).not.toBe(SVG_NS);
    expect(div.textContent).toBe("hello");
  });

  test("fragment children inside <svg> are adopted (<>...</> and components)", () => {
    const Shapes = () => (
      <>
        <circle r="1" data-kind="comp" />
      </>
    );
    const svg = (
      <svg>
        <>
          <circle r="10" data-kind="frag" />
          <rect width="5" data-kind="frag" />
        </>
        <Shapes />
      </svg>
    ) as unknown as SVGElement;
    const kids = [...svg.querySelectorAll("[data-kind]")];
    expect(kids).toHaveLength(3);
    expect(kids.every((k) => k.namespaceURI === SVG_NS)).toBe(true);
  });

  test("when() inside foreignObject renders HTML-namespace content", async () => {
    const open = signal(true);
    const svg = (
      <svg>
        <foreignObject width="100" height="100">
          {when(open, () => <p class="note">html note</p>)}
        </foreignObject>
      </svg>
    ) as unknown as SVGElement;
    document.body.append(svg);
    await flush();
    const p = svg.querySelector("p.note")!;
    expect(p).not.toBeNull();
    expect(p.namespaceURI).not.toBe(SVG_NS);
  });
});

// ============================================================ synchronous first render, dispose guard & row bracket ranges

describe("when()/list(): synchronous first render, dispose guards, row brackets", () => {
  beforeEach(() => { document.body.innerHTML = ""; });

  test("when(): renders synchronously, and a same-tick dispose leaves nothing live", async () => {
    const cond = signal(true);
    const dep = signal(0);
    let builds = 0;
    let branchRuns = 0;
    const root = document.createElement("div");
    document.body.append(root);
    const dispose = mount(root, () =>
      when(cond, () => {
        builds++;
        effect(() => { dep.get(); branchRuns++; });
        return document.createElement("span");
      }),
    );
    expect(builds).toBe(1); // no microtask wait — the branch is already built
    expect(root.querySelector("span")).not.toBeNull();
    dispose();
    await flush();
    expect(builds).toBe(1); // nothing rebuilds after dispose
    expect(root.querySelector("span")).toBeNull();
    const runs = branchRuns;
    dep.set(1); // and no orphaned branch effect is left responding
    expect(branchRuns).toBe(runs);
    cond.set(false);
    cond.set(true);
    expect(builds).toBe(1);
  });

  test("list(): renders synchronously, and a same-tick dispose leaves nothing live", async () => {
    const rows = signal([{ id: 1 }, { id: 2 }]);
    let builds = 0;
    const root = document.createElement("div");
    document.body.append(root);
    // Nested one element deep: after dispose the list anchor still has a
    // (detached) parent, so only the disposed guard prevents a rebuild.
    const dispose = mount(root, () => (
      <ul>{list(rows, (r) => r.id, () => { builds++; return <li />; })}</ul>
    ));
    expect(builds).toBe(2);
    expect(root.querySelectorAll("li")).toHaveLength(2);
    dispose();
    await flush();
    rows.set([{ id: 1 }, { id: 2 }, { id: 3 }]);
    expect(builds).toBe(2);
  });

  test("list(): reordering rows whose root is a when() moves the branch nodes too", async () => {
    const rows = signal([
      { id: 1, label: "one" },
      { id: 2, label: "two" },
    ]);
    const root = document.createElement("div");
    document.body.append(root);
    const dispose = mount(root, () =>
      list(rows, (r) => r.id, (r$) =>
        when(signal(true), () => {
          const s = document.createElement("span");
          s.textContent = r$.peek().label;
          return s;
        }),
      ),
    );
    expect(root.textContent).toBe("onetwo");

    rows.set([{ id: 2, label: "two" }, { id: 1, label: "one" }]);
    expect(root.textContent).toBe("twoone");

    // Removal tears the whole row range (when anchor + branch) out of the DOM.
    rows.set([{ id: 1, label: "one" }]);
    expect(root.textContent).toBe("one");
    expect(root.querySelectorAll("span")).toHaveLength(1);
    dispose();
  });

  test("list(): multi-node fragment rows stay grouped through reorder", async () => {
    const rows = signal([{ id: "a" }, { id: "b" }]);
    const root = document.createElement("div");
    document.body.append(root);
    const dispose = mount(root, () =>
      list(rows, (r) => r.id, (r$) => (
        <>
          <b>{r$.peek().id}</b>
          <i>{r$.peek().id}</i>
        </>
      )),
    );
    await tick();
    expect(root.textContent).toBe("aabb");
    rows.set([{ id: "b" }, { id: "a" }]);
    expect(root.textContent).toBe("bbaa");
    dispose();
  });

  test("list(): index-based rows rebuild in place between their brackets", async () => {
    const rows = signal(["x", "y"]);
    const root = document.createElement("div");
    document.body.append(root);
    const dispose = mount(root, () =>
      list(rows, (item) => {
        const li = document.createElement("li");
        li.textContent = item;
        return li;
      }),
    );
    await tick();
    expect(root.textContent).toBe("xy");
    rows.set(["y", "x"]);
    expect(root.textContent).toBe("yx");
    dispose();
    expect(root.querySelectorAll("li")).toHaveLength(0);
  });
});

// ============================================================ list() item-signal equality (in-place patch streams)

describe("list(): item-signal equals option for in-place patch streams", () => {
  beforeEach(() => { document.body.innerHTML = ""; });

  type Card = { id: number; title: string };
  const makeDoc = () =>
    signal<{ cards: Record<string, Card> }>({
      cards: { "1": { id: 1, title: "one" }, "2": { id: 2, title: "two" } },
    });

  const mountCards = (
    doc: ReturnType<typeof makeDoc>,
    root: HTMLElement,
    options?: { equals: (a: Card, b: Card) => boolean },
  ) => {
    const cards = doc.map((d) => Object.values(d.cards));
    return mount(root, () =>
      list(cards, (c) => c.id, (c$) => {
        const li = document.createElement("li");
        effect(() => { li.textContent = c$.get().title; });
        return li;
      }, options),
    );
  };

  test("default Object.is: in-place row mutation + touch() leaves the row stale (why the option exists)", async () => {
    const doc = makeDoc();
    const root = document.createElement("div");
    document.body.append(root);
    const dispose = mountCards(doc, root);
    await tick();
    expect(root.textContent).toBe("onetwo");

    // delta-style field-level op: mutate the row object in place, touch().
    // The sync re-delivers the SAME reference, so the item signal bails —
    // the immutable-update contract. { equals } exists for the other case.
    doc.peek().cards["1"]!.title = "ONE";
    doc.touch();
    expect(root.textContent).toBe("onetwo");
    dispose();
  });

  test("{ equals: () => false }: in-place mutation + touch() updates row DOM", async () => {
    const doc = makeDoc();
    const root = document.createElement("div");
    document.body.append(root);
    const dispose = mountCards(doc, root, { equals: () => false });
    await tick();
    expect(root.textContent).toBe("onetwo");

    doc.peek().cards["1"]!.title = "ONE";
    doc.touch();
    expect(root.textContent).toBe("ONEtwo");

    // Whole-row replacement and removal keep working under the option.
    doc.peek().cards["2"] = { id: 2, title: "TWO" };
    doc.touch();
    expect(root.textContent).toBe("ONETWO");

    delete doc.peek().cards["1"];
    doc.touch();
    expect(root.textContent).toBe("TWO");
    dispose();
  });
});

// ============================================================ mount() & scope guardrails

describe("mount() and scope-less warnings", () => {
  beforeEach(() => { document.body.innerHTML = ""; });

  test("mount() scopes effects and removes nodes on dispose", () => {
    const count = signal(0);
    let runs = 0;
    const dispose = mount(document.body, () => {
      effect(() => { count.get(); runs++; });
      return <main id="app">{count}</main>;
    });
    expect(document.querySelector("#app")).not.toBeNull();
    expect(runs).toBe(1);
    count.set(1);
    expect(runs).toBe(2);

    dispose();
    count.set(2);
    expect(runs).toBe(2); // effect dead
    expect(document.querySelector("#app")).toBeNull(); // nodes removed
  });

  test("when()/list() inside mount() do not warn and are disposed with it", async () => {
    const warnSpy = spyOn(console, "warn").mockImplementation(() => {});
    const flag = signal(true);
    const rows = signal([{ id: 1 }]);
    const dispose = mount(document.body, () => (
      <div>
        {when(flag, () => <span>on</span>)}
        <ul>{list(rows, (r) => r.id, () => <li />)}</ul>
      </div>
    ));
    await flush();
    expect(
      warnSpy.mock.calls.some((c) => String(c[0]).includes("outside a dispose scope")),
    ).toBe(false);
    expect(document.querySelector("span")?.textContent).toBe("on");
    dispose();
    warnSpy.mockRestore();
  });

  test("a throwing render disposes partial children and rethrows", () => {
    const s = signal(0);
    let runs = 0;
    expect(() =>
      mount(document.body, () => {
        effect(() => { s.get(); runs++; });
        throw new Error("render boom");
      }),
    ).toThrow("render boom");
    s.set(1);
    expect(runs).toBe(1); // partial effect was disposed
  });

  test("scope-less when() and list() warn with guidance", () => {
    const warnSpy = spyOn(console, "warn").mockImplementation(() => {});
    when(signal(true), () => document.createElement("i"));
    list(signal([1]), (n) => document.createElement("li"));
    const texts = warnSpy.mock.calls.map((c) => String(c[0]));
    expect(texts.some((t) => t.includes("[railroad/when]") && t.includes("mount()"))).toBe(true);
    expect(texts.some((t) => t.includes("[railroad/list]") && t.includes("mount()"))).toBe(true);
    warnSpy.mockRestore();
  });

  test("SVG-only tags get the SVG namespace at creation, even standalone", () => {
    const circle = (<circle r="5" />) as unknown as Element;
    expect(circle.namespaceURI).toBe(SVG_NS);
    const grad = (<linearGradient id="x" />) as unknown as Element;
    expect(grad.localName).toBe("linearGradient");
    expect(grad.namespaceURI).toBe(SVG_NS);
    // refs fire exactly once for SVG-only tags — no adoption pass.
    const refs: Element[] = [];
    const svg = (
      <svg>
        <rect ref={(el: Element) => { refs.push(el); }} />
      </svg>
    ) as unknown as SVGElement;
    expect(refs).toHaveLength(1);
    expect(refs[0]!.namespaceURI).toBe(SVG_NS);
    expect(svg.querySelector("rect")).toBe(refs[0] as any);
  });

  test("ambiguous <a> still adopts inside <svg>, stays HTML outside", () => {
    const svg = (
      <svg>
        <a href="#x"><circle r="1" /></a>
      </svg>
    ) as unknown as SVGElement;
    const link = svg.querySelector("a")!;
    expect(link.namespaceURI).toBe(SVG_NS);
    expect(link.querySelector("circle")!.namespaceURI).toBe(SVG_NS);

    const htmlLink = (<a href="#y">text</a>) as unknown as Element;
    expect(htmlLink.namespaceURI).not.toBe(SVG_NS);
  });
});

// ============================================================ routes.ts

describe("routes: async scope / idempotency / param race / onError", () => {
  beforeEach(async () => { document.body.innerHTML = ""; location.hash = "#/"; await tick(); });
  afterEach(() => { location.hash = ""; });

  test("async first render inside a parent scope: no leak, no stack overflow", async () => {
    const target = document.createElement("div");
    document.body.append(target);
    let parentSentinel = 0;

    pushDisposeScope();
    trackDispose(() => { parentSentinel++; });
    const dispose = routes(target, {
      "/": async () => {
        const el = document.createElement("section");
        el.textContent = "home";
        return el;
      },
    });
    const parentDispose = popDisposeScope();

    await tick();
    expect(target.textContent).toBe("home");

    let overflowed = false;
    try { dispose(); } catch (e) { overflowed = e instanceof RangeError; }
    parentDispose();

    expect(overflowed).toBe(false);
    expect(parentSentinel).toBe(1); // parent disposer fired exactly once
  });

  test("async handler thunk resolution: post-await bindings die on navigation", async () => {
    const name = signal("a");
    const target = document.createElement("div");
    document.body.append(target);
    const dispose = routes(target, {
      "/": async () => {
        await Promise.resolve();
        // Reactive binding built AFTER the first await — with a bare
        // Promise<Node> resolution this had no owner scope and outlived the
        // route (the pre-0.11 leak); the thunk gives railroad the moment to
        // provide one.
        return () => <span>{name}</span>;
      },
      "/other": () => <p>other</p>,
    });
    await tick();
    expect(target.textContent).toBe("a");
    expect((name as any).listeners.size).toBe(1);
    navigate("/other");
    await tick();
    expect((name as any).listeners.size).toBe(0); // binding disposed with the route
    expect(target.textContent).toBe("other");
    dispose();
  });

  test("double-dispose is idempotent and does not break a sibling router", async () => {
    const tA = document.createElement("div");
    const tB = document.createElement("div");
    document.body.append(tA, tB);

    const mk = (tag: string) => ({
      "/": () => { const el = document.createElement("span"); el.textContent = `${tag}-home`; return el; },
      "/about": () => { const el = document.createElement("span"); el.textContent = `${tag}-about`; return el; },
    });
    const da = routes(tA, mk("A"));
    const db = routes(tB, mk("B"));
    expect(tB.textContent).toBe("B-home");

    da(); da(); // double-dispose A — must not drive the shared refcount negative

    navigate("/about");
    await tick();
    expect(tB.textContent).toBe("B-about"); // sibling router still responds
    db();
  });

  test("same-pattern param change during a pending async render re-runs the handler", async () => {
    const target = document.createElement("div");
    document.body.append(target);
    location.hash = "#/users/1";
    await tick();

    const calls: string[] = [];
    const deferreds = new Map<string, ReturnType<typeof defer<Node>>>();
    const dispose = routes(target, {
      "/users/:id": (params) => {
        const id = params.id!;
        calls.push(id);
        const d = defer<Node>();
        deferreds.set(id, d);
        return d.promise;
      },
    });
    expect(calls).toEqual(["1"]); // first render in flight

    navigate("/users/2");
    await tick();
    expect(calls).toEqual(["1", "2"]); // re-ran with new params, not just params$.set

    // Resolve the stale "1" render — it must be discarded.
    const stale = document.createElement("span"); stale.textContent = "user 1";
    deferreds.get("1")!.resolve(stale);
    // Resolve "2" — it should paint.
    const fresh = document.createElement("span"); fresh.textContent = "user 2";
    deferreds.get("2")!.resolve(fresh);
    await tick();
    expect(target.textContent).toBe("user 2");
    dispose();
  });

  test("a throwing onError on the async-reject path is contained (no unhandled rejection)", async () => {
    const errSpy = spyOn(console, "error").mockImplementation(() => {});
    const target = document.createElement("div");
    document.body.append(target);
    location.hash = "#/x";
    await tick();

    const d = defer<Node>();
    const dispose = routes(
      target,
      { "/x": () => d.promise },
      { onError: () => { throw new Error("boundary fail"); } },
    );
    d.reject(new Error("handler fail"));
    try { await d.promise; } catch {}
    await tick();

    expect(
      errSpy.mock.calls.some((c) => String(c[0]).includes("onError boundary threw")),
    ).toBe(true);
    errSpy.mockRestore();
    dispose();
  });

  test("matchRoute keeps the raw segment when a :param has a malformed escape", () => {
    expect(matchRoute("/u/:id", "/u/%zz")).toEqual({ id: "%zz" });
  });
});

// ============================================================ shared.ts

describe("shared: provide(undefined) / clearProviders", () => {
  afterEach(() => clearProviders());

  test("provide(undefined) is honored — inject does not throw", () => {
    const K = key<number | undefined>("opt");
    provide(K, undefined);
    expect(() => inject(K)).not.toThrow();
    expect(inject(K)).toBeUndefined();
  });

  test("clearProviders resets the registry", () => {
    const K = key<string>("x");
    provide(K, "v");
    expect(inject(K)).toBe("v");
    clearProviders();
    expect(() => inject(K)).toThrow(/No provider/);
  });
});

// ============================================================ logger.ts

describe("logger: color gating", () => {
  test("does not emit ANSI escapes when stdout is not a TTY", () => {
    // bun test runs piped (non-TTY); colors must be suppressed so piped logs and
    // log files stay clean. Skip if running in an interactive terminal.
    if ((process as any).stdout?.isTTY) return;
    const logSpy = spyOn(console, "log").mockImplementation(() => {});
    setLogLevel("info");
    createLogger("[t]").info("plain");
    expect(String(logSpy.mock.calls[0]![0])).not.toContain("\x1b[");
    logSpy.mockRestore();
    setLogLevel("info");
  });
});

// ============================================================ review guards
// Fixes from the 0.10.1 full review — missing guardrails, not logic bugs.
// Each pins a footgun that previously failed silently or inscrutably.

describe("async components: thunk resolution + fallback", () => {
  beforeEach(() => { document.body.innerHTML = ""; });

  test("renders via its thunk; fallback shows until resolution, then swaps out", async () => {
    const d = defer<string>();
    async function Profile() {
      const name = await d.promise;
      return () => <div class="profile">{name}</div>;
    }
    const root = document.createElement("div");
    document.body.append(root);
    const dispose = mount(root, () => (
      <main>
        <Profile fallback={() => <p>loading…</p>} />
      </main>
    ));
    expect(root.textContent).toBe("loading…");
    d.resolve("Ada");
    await tick();
    expect(root.textContent).toBe("Ada");
    expect(root.querySelector("p")).toBeNull(); // fallback removed
    dispose();
    expect(root.textContent).toBe("");
  });

  test("thunk-created effects are owned and die on teardown", async () => {
    const dep = signal(0);
    let runs = 0;
    async function Live() {
      await Promise.resolve();
      return () => {
        effect(() => { dep.get(); runs++; });
        return <b>x</b>;
      };
    }
    const root = document.createElement("div");
    document.body.append(root);
    const dispose = mount(root, () => <Live />);
    await tick();
    expect(runs).toBe(1);
    dep.set(1);
    expect(runs).toBe(2);
    dispose();
    dep.set(2);
    expect(runs).toBe(2); // disposed with the component — the whole contract
  });

  test("pre-await effects are scoped; dispose before resolution drops the thunk", async () => {
    const dep = signal(0);
    let preRuns = 0;
    let thunkRuns = 0;
    const d = defer<void>();
    async function Widget() {
      effect(() => { dep.get(); preRuns++; }); // sync prefix — component scope
      await d.promise;
      return () => { thunkRuns++; return <i>late</i>; };
    }
    const root = document.createElement("div");
    document.body.append(root);
    const dispose = mount(root, () => <Widget fallback={() => <p>…</p>} />);
    expect(preRuns).toBe(1);
    expect(root.textContent).toBe("…");
    dispose(); // before resolution
    dep.set(1);
    expect(preRuns).toBe(1); // pre-await effect died with the scope
    d.resolve();
    await tick();
    expect(thunkRuns).toBe(0); // resolution after dispose builds nothing
    expect(root.textContent).toBe("");
  });

  test("a bare-Node resolution errors pointedly and renders nothing", async () => {
    const errorSpy = spyOn(console, "error").mockImplementation(() => {});
    async function Wrong() {
      await Promise.resolve();
      return (<div>oops</div>) as any; // Node, not a thunk — the old footgun
    }
    const root = document.createElement("div");
    document.body.append(root);
    const dispose = mount(root, () => <Wrong fallback={() => <p>…</p>} />);
    await tick();
    expect(root.textContent).toBe(""); // fallback cleared, node not inserted
    expect(
      errorSpy.mock.calls.some((c) => String(c[0]).includes("resolve to a thunk")),
    ).toBe(true);
    errorSpy.mockRestore();
    dispose();
  });

  test("a rejecting async component clears its fallback and reports", async () => {
    const errorSpy = spyOn(console, "error").mockImplementation(() => {});
    const d = defer<never>();
    async function Doomed() {
      await d.promise;
      return () => <span>never</span>;
    }
    const root = document.createElement("div");
    document.body.append(root);
    const dispose = mount(root, () => <Doomed fallback={() => <p>loading…</p>} />);
    expect(root.textContent).toBe("loading…");
    d.reject(new Error("boom"));
    await tick();
    expect(root.textContent).toBe(""); // no stuck spinner hiding the failure
    expect(
      errorSpy.mock.calls.some((c) => String(c[0]).includes("rejected")),
    ).toBe(true);
    errorSpy.mockRestore();
    dispose();
  });

  test("async components as keyed list() rows: resolved content travels on reorder", async () => {
    const rows = signal([{ id: 1, label: "one" }, { id: 2, label: "two" }]);
    async function Title(props: { label: string }) {
      await Promise.resolve();
      return () => <span>{props.label}</span>;
    }
    const root = document.createElement("div");
    document.body.append(root);
    const dispose = mount(root, () =>
      list(rows, (r) => r.id, (r$) => <Title label={r$.peek().label} />),
    );
    await tick(); // list sync, then each row's resolution
    expect(root.textContent).toBe("onetwo");
    rows.set([{ id: 2, label: "two" }, { id: 1, label: "one" }]);
    expect(root.textContent).toBe("twoone"); // row brackets carry async content
    dispose();
    expect(root.textContent).toBe("");
  });

  test("a non-thunk fallback warns and is ignored", async () => {
    const warnSpy = spyOn(console, "warn").mockImplementation(() => {});
    async function P() {
      await Promise.resolve();
      return () => <span>ok</span>;
    }
    const root = document.createElement("div");
    document.body.append(root);
    const dispose = mount(root, () => <P fallback={(<p>eager</p>) as any} />);
    expect(root.textContent).toBe(""); // eager Node ignored, not inserted
    expect(
      warnSpy.mock.calls.some((c) => String(c[0]).includes("fallback must be a thunk")),
    ).toBe(true);
    await tick();
    expect(root.textContent).toBe("ok");
    warnSpy.mockRestore();
    dispose();
  });
});

describe("guard: non-function on* props warn and attach nothing", () => {
  test("a Signal as onclick warns (mentioning Signal) and the click is inert", () => {
    const warnSpy = spyOn(console, "warn").mockImplementation(() => {});
    const clicks = signal(0);
    const btn = createElement("button", { onclick: clicks }, "go") as HTMLButtonElement;
    document.body.appendChild(btn);
    btn.dispatchEvent(new Event("click"));
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(String(warnSpy.mock.calls[0]![0])).toContain("Signal");
    expect(clicks.peek()).toBe(0);
    warnSpy.mockRestore();
    btn.remove();
  });

  test("null/undefined handlers stay legal — no warning, no listener", () => {
    const warnSpy = spyOn(console, "warn").mockImplementation(() => {});
    createElement("button", { onclick: undefined }, "a");
    createElement("button", { onclick: null }, "b");
    expect(warnSpy).not.toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  test("a real function still attaches", () => {
    let n = 0;
    const btn = createElement("button", { onclick: () => n++ }, "go") as HTMLButtonElement;
    document.body.appendChild(btn);
    btn.dispatchEvent(new Event("click"));
    expect(n).toBe(1);
    btn.remove();
  });
});

describe("guard: .patch() refuses array signals", () => {
  test("patch on an array throws instead of corrupting to an index-keyed object", () => {
    const rows = signal([{ id: 1 }, { id: 2 }]);
    expect(() => (rows as any).patch({ id: 3 })).toThrow(/array/i);
    expect(Array.isArray(rows.peek())).toBe(true); // value untouched
  });

  test("patch on an object signal still shallow-merges", () => {
    const filter = signal({ color: "all", done: false });
    filter.patch({ color: "blue" });
    expect(filter.peek()).toEqual({ color: "blue", done: false });
  });
});

// ============================================================ 0.12 review: props, style, effect ownership, sync render

describe("props: functions are reactive like children", () => {
  test("class={() => …} tracks instead of stringifying the function", () => {
    const open = signal(false);
    const el = <div class={() => (open.get() ? "open" : "shut")} /> as HTMLElement;
    expect(el.getAttribute("class")).toBe("shut");
    open.set(true);
    expect(el.getAttribute("class")).toBe("open");
  });

  test("generic attributes and DOM properties accept functions", () => {
    const n = signal(1);
    const el = <input title={() => `n=${n.get()}`} value={() => String(n.get())} disabled={() => n.get() > 1} /> as HTMLInputElement;
    expect(el.getAttribute("title")).toBe("n=1");
    expect(el.value).toBe("1");
    expect(el.disabled).toBe(false);
    n.set(2);
    expect(el.getAttribute("title")).toBe("n=2");
    expect(el.value).toBe("2");
    expect(el.disabled).toBe(true);
  });

  test("function props dispose with their scope", () => {
    const open = signal(false);
    let reads = 0;
    let el!: HTMLElement;
    const dispose = mount(document.createElement("div"), () => {
      el = <div class={() => { reads++; return open.get() ? "a" : "b"; }} /> as HTMLElement;
      return el;
    });
    dispose();
    const before = reads;
    open.set(true);
    expect(reads).toBe(before);
    expect(el.getAttribute("class")).toBe("b");
  });

  test("ref and on* functions are still called / attached, not tracked", () => {
    const refs: Element[] = [];
    let clicks = 0;
    const el = <button ref={(e: Element) => { refs.push(e); }} onclick={() => clicks++} /> as HTMLButtonElement;
    expect(refs).toEqual([el]);
    el.click();
    expect(clicks).toBe(1);
  });
});

describe("props: style and class edge values", () => {
  test("style={Signal<string>} sets cssText instead of throwing", () => {
    const s = signal("color: red");
    const el = <div style={s} /> as HTMLElement;
    expect(el.style.color).toBe("red");
    s.set("color: blue; font-weight: bold");
    expect(el.style.color).toBe("blue");
    expect(el.style.fontWeight).toBe("bold");
  });

  test("reactive style can switch between string and object forms", () => {
    const s = signal<string | Record<string, string> | null>("color: red");
    const el = <div style={s} /> as HTMLElement;
    s.set({ fontWeight: "bold" });
    expect(el.style.color).toBe("");
    expect(el.style.fontWeight).toBe("bold");
    s.set("color: green");
    expect(el.style.fontWeight).toBe("");
    expect(el.style.color).toBe("green");
    s.set(null);
    expect(el.hasAttribute("style")).toBe(false);
  });

  test("style={() => …} is reactive", () => {
    const w = signal(10);
    const el = <div style={() => ({ width: `${w.get()}px` })} /> as HTMLElement;
    expect(el.style.width).toBe("10px");
    w.set(20);
    expect(el.style.width).toBe("20px");
  });

  test("class={null | undefined | false} removes the attribute", () => {
    const s = signal<string | undefined>(undefined);
    const el = <div class={s} /> as HTMLElement;
    expect(el.hasAttribute("class")).toBe(false);
    s.set("x");
    expect(el.getAttribute("class")).toBe("x");
    s.set(undefined);
    expect(el.hasAttribute("class")).toBe(false);
    expect((<div class={null} /> as HTMLElement).hasAttribute("class")).toBe(false);
  });
});

describe("effect(): each run owns what it creates", () => {
  test("a computed created inside an effect is disposed on the next run", () => {
    const a = signal(0);
    let innerRuns = 0;
    const dispose = effect(() => {
      a.get();
      computed(() => { innerRuns++; return a.get(); });
    });
    innerRuns = 0;
    for (let i = 1; i <= 5; i++) a.set(i);
    // One fresh inner computed per run; the previous run's is gone, so it
    // doesn't also re-evaluate (before the fix: 1+2+3+4+5 + 5 = 20).
    expect(innerRuns).toBe(5);
    dispose();
    a.set(99);
    expect(innerRuns).toBe(5);
  });

  test("a nested effect is disposed before re-run and on dispose", () => {
    const outer = signal(0);
    const inner = signal(0);
    let innerRuns = 0;
    const dispose = effect(() => {
      outer.get();
      effect(() => { inner.get(); innerRuns++; });
    });
    outer.set(1);
    outer.set(2);
    innerRuns = 0;
    inner.set(1);
    expect(innerRuns).toBe(1); // only the live nested effect responds
    dispose();
    inner.set(2);
    expect(innerRuns).toBe(1);
  });

  test("a throwing effect body still balances the dispose stack and owns its children", () => {
    const a = signal(0);
    let innerRuns = 0;
    pushDisposeScope();
    expect(() =>
      effect(() => {
        computed(() => { innerRuns++; return a.get(); });
        throw new Error("boom");
      }),
    ).toThrow("boom");
    const outerDispose = popDisposeScope(); // would throw on imbalance
    outerDispose();
    innerRuns = 0;
    a.set(1);
    expect(innerRuns).toBe(0);
  });

  test("a function child's effects from earlier runs are cleaned up, not accumulated", () => {
    const n = signal(0);
    let builds = 0;
    let live = 0;
    const root = document.createElement("div");
    const dispose = mount(root, () => (
      <div>{() => {
        n.get();
        const probe = signal(0);
        effect(() => { probe.get(); live++; return () => { live--; }; });
        builds++;
        return "";
      }}</div>
    ));
    for (let i = 1; i <= 4; i++) n.set(i);
    expect(builds).toBe(5);
    expect(live).toBe(1); // earlier runs' effects were cleaned up
    dispose();
    expect(live).toBe(0);
  });
});

describe("when()/list(): content is in the DOM when mount() returns", () => {
  test("when() branch is present synchronously", () => {
    const root = document.createElement("div");
    const on = signal(true);
    const dispose = mount(root, () => <div>{when(on, () => <p>hi</p>, () => <p>bye</p>)}</div>);
    expect(root.textContent).toBe("hi");
    on.set(false);
    expect(root.textContent).toBe("bye");
    dispose();
  });

  test("a ref inside a when() branch sees a connected element after mount()", () => {
    const root = document.createElement("div");
    document.body.append(root);
    let el: Element | null = null;
    const dispose = mount(root, () => <div>{when(signal(true), () => <input ref={(e: Element) => { el = e; }} />)}</div>);
    expect(el).not.toBeNull();
    expect(el!.isConnected).toBe(true);
    dispose();
    root.remove();
  });

  test("list() rows are present synchronously, nested when() included", () => {
    const root = document.createElement("div");
    const rows = signal([{ id: 1, t: "a" }, { id: 2, t: "b" }]);
    const dispose = mount(root, () => (
      <ul>{list(rows, (r) => r.id, (r$) => <li>{when(signal(true), () => <span>{r$.map((r) => r.t)}</span>)}</li>)}</ul>
    ));
    expect(root.textContent).toBe("ab");
    dispose();
  });

  test("when() with an SVG-ambiguous tag inside <svg> still swaps cleanly after adoption", () => {
    const root = document.createElement("div");
    const on = signal(true);
    const dispose = mount(root, () => (
      <svg>{when(on, () => <a href="#x"><text>link</text></a>, () => <circle r="1" />)}</svg>
    ));
    const svg = root.querySelector("svg")!;
    expect(root.querySelector("a")!.namespaceURI).toBe(SVG_NS);
    on.set(false);
    expect(root.querySelector("a")).toBeNull();
    expect(root.querySelectorAll("circle")).toHaveLength(1);
    on.set(true);
    expect(root.querySelectorAll("a")).toHaveLength(1);
    expect(root.querySelector("circle")).toBeNull();
    dispose();
    // Only the brackets' removal-by-dispose matters here: no branch survives.
    expect(svg.querySelector("a")).toBeNull();
    expect(svg.querySelector("circle")).toBeNull();
  });
});

describe("props: remaining 0.12 paths (static style, innerHTML, SVG adoption)", () => {
  test("static style accepts a CSS string or an object; empty/false/null leave no attribute", () => {
    const str = <div style="color: red; font-weight: bold" /> as HTMLElement;
    expect(str.style.color).toBe("red");
    expect(str.style.fontWeight).toBe("bold");
    const obj = <div style={{ color: "blue" }} /> as HTMLElement;
    expect(obj.style.color).toBe("blue");
    for (const empty of ["", false, null]) {
      expect((<div style={empty as any} /> as HTMLElement).hasAttribute("style")).toBe(false);
    }
  });

  test("innerHTML={() => …} is reactive and null clears it", () => {
    const html = signal<string | null>("<b>hi</b>");
    const el = <div innerHTML={() => html.get()} /> as HTMLElement;
    expect(el.innerHTML).toBe("<b>hi</b>");
    html.set(null);
    expect(el.innerHTML).toBe("");
  });

  test("a function prop on an SVG-adopted tag keeps exactly one live effect", () => {
    const href = signal("#a");
    let reads = 0;
    const root = document.createElement("div");
    // Hand-built, so it has attributes but no stored props.
    const handTitle = document.createElement("title");
    handTitle.setAttribute("id", "t");
    const dispose = mount(root, () => (
      <svg>
        <a href={() => { reads++; return href.get(); }}><text>link</text></a>
        {handTitle}
      </svg>
    ));
    const a = root.querySelector("a")!;
    const title = root.querySelector("title")!;
    expect(a.namespaceURI).toBe(SVG_NS);
    expect(title.namespaceURI).toBe(SVG_NS); // no props: attributes copied across
    expect(title.getAttribute("id")).toBe("t");
    expect(a.getAttribute("href")).toBe("#a");
    reads = 0;
    href.set("#b");
    // The discarded HTML <a>'s effect was disposed during adoption — only the
    // SVG element's effect re-runs.
    expect(reads).toBe(1);
    expect(a.getAttribute("href")).toBe("#b");
    dispose();
    href.set("#c");
    expect(reads).toBe(1);
  });
});

// ============================================================ routes() into an SVG target

describe("routes() into an <svg> target", () => {
  afterEach(() => {
    location.hash = "";
  });

  // when()/list() render their first branch synchronously (0.12), into their own fragment, so the
  // namespace is decided where the fragment is placed. routes() places what a handler returns the
  // way mount() does: adopted into the target's namespace.
  test("a handler's when() and its plain elements land in the SVG namespace", async () => {
    const svg = document.createElementNS(SVG_NS, "svg");
    document.body.append(svg);
    location.hash = "#/";
    await tick();
    const dispose = routes(svg, {
      "/": () => (
        <>
          <a data-testid="plain" />
          {when(() => true, () => <a data-testid="branch" />)}
        </>
      ),
    });
    expect(svg.querySelector("[data-testid=plain]")!.namespaceURI).toBe(SVG_NS);
    expect(svg.querySelector("[data-testid=branch]")!.namespaceURI).toBe(SVG_NS);
    dispose();
    svg.remove();
  });

  test("a bare when() returned by a handler lands in the SVG namespace", async () => {
    const svg = document.createElementNS(SVG_NS, "svg");
    document.body.append(svg);
    location.hash = "#/";
    await tick();
    const dispose = routes(svg, { "/": () => when(() => true, () => <a data-testid="bare" />) });
    expect(svg.querySelector("[data-testid=bare]")!.namespaceURI).toBe(SVG_NS);
    dispose();
    svg.remove();
  });
});

// ============================================================ when(): a branch that throws

describe("when(): a branch that throws", () => {
  // The branch renders under a scope of its own; a throw must not leave that scope pushed, or
  // every later push and pop is off by one (0.11 left it pushed).
  test("leaves the dispose stack as it found it", () => {
    const hadScope = hasActiveDisposeScope();
    pushDisposeScope();
    try {
      when(signal(true), () => {
        throw new Error("branch failed");
      });
    } catch {
      // the throw is the branch's own
    }
    popDisposeScope()();
    expect(hasActiveDisposeScope()).toBe(hadScope);
  });
});

// ============================================================ effect(): a first run that writes its own dependency

describe("effect(): a first run that writes its own dependency", () => {
  // The first run used to start a flush of its own when it wrote a signal it had read, so the
  // effect ran again INSIDE itself; the outer run then overwrote the inner run's cleanup and
  // children, which were never disposed. The first run now defers its writes like batch().
  test("re-runs after its body, and loses no cleanup or child", () => {
    const a = signal(0);
    const b = signal(0);
    let bodies = 0, cleanups = 0, innerRuns = 0, depth = 0, maxDepth = 0;
    const dispose = effect(() => {
      maxDepth = Math.max(maxDepth, ++depth);
      const v = a.get();
      if (v < 2) a.set(v + 1); // e.g. clamp or default a selection
      bodies++;
      effect(() => { b.get(); innerRuns++; });
      depth--;
      return () => { cleanups++; };
    });
    expect(maxDepth).toBe(1); // never re-entered
    expect(bodies).toBe(3);
    expect(cleanups).toBe(2); // every earlier run cleaned up
    innerRuns = 0;
    b.set(1);
    expect(innerRuns).toBe(1); // one live child, not one per run
    dispose();
    expect(cleanups).toBe(3);
    innerRuns = 0;
    b.set(2);
    expect(innerRuns).toBe(0);
  });

  test("a clamping effect in a component leaves no timer behind after unmount", () => {
    const page = signal(5);
    const pageCount = signal(3);
    let live = 0;
    function Pager() {
      effect(() => {
        if (page.get() > pageCount.get()) page.set(pageCount.get());
        live++;
        return () => { live--; };
      });
      return <p>{page}</p>;
    }
    const root = document.createElement("div");
    const dispose = mount(root, () => <Pager />);
    expect(root.textContent).toBe("3");
    expect(live).toBe(1);
    dispose();
    expect(live).toBe(0);
  });

  test("reads its own writes the same way on every run: stale, then re-run", () => {
    const a = signal(1);
    const b = computed(() => a.get() * 10);
    const trigger = signal(0);
    const log: string[] = [];
    effect(() => { const t = trigger.get(); a.set(t + 100); log.push(`t=${t} b=${b.get()}`); });
    trigger.set(1);
    // before: the first run saw b fresh (1000) and later runs saw it stale
    expect(log).toEqual(["t=0 b=10", "t=0 b=1000", "t=1 b=1000", "t=1 b=1010"]);
  });

  test("writes made before a first run throws still propagate, and the error surfaces", () => {
    const other = signal(0);
    let seen = -1;
    effect(() => { seen = other.get(); });
    expect(() => effect(() => { other.set(7); throw new Error("first run failed"); })).toThrow("first run failed");
    expect(seen).toBe(7);
  });
});

// ============================================================ render bodies are untracked

describe("render bodies are untracked: a .get() there subscribes nothing around it", () => {
  // A .get() in a component body, a when() branch, a list() row or a route handler ran with the
  // surrounding effect as the listener, so an unrelated write re-ran that effect: every
  // index-based row rebuilt, a router re-notified params$, a user effect re-rendered.
  beforeEach(async () => { location.hash = "#/users/1"; await tick(); });
  afterEach(() => { location.hash = ""; });

  const countReads = <T,>(s: ReadonlySignal<T>) => {
    const get = s.get.bind(s);
    const counter = { n: 0 };
    (s as { get: () => T }).get = () => { counter.n++; return get(); };
    return counter;
  };

  test("an index-based list() row that reads another signal is not rebuilt when it changes", () => {
    const items = signal(["a", "b", "c"]);
    const theme = signal("light");
    let renders = 0;
    const root = document.createElement("div");
    const dispose = mount(root, () => (
      <ul>{list(items, (it) => { renders++; return <li class={theme.get()}>{it}</li>; })}</ul>
    ));
    theme.set("dark");
    expect(renders).toBe(3); // before: 6, every row rebuilt
    dispose();
  });

  test("a keyed list() row's reads don't re-run the list", () => {
    const items = signal([{ id: 1 }, { id: 2 }]);
    const sel = signal(1);
    const root = document.createElement("div");
    const dispose = mount(root, () => (
      <ul>{list(items, (r) => r.id, (r$) => <li>{r$.peek().id}{sel.get()}</li>)}</ul>
    ));
    const reads = countReads(items);
    sel.set(2);
    expect(reads.n).toBe(0);
    dispose();
  });

  test("a when() branch's reads don't re-run the when()", () => {
    const show = signal(true);
    const other = signal(0);
    const root = document.createElement("div");
    const dispose = mount(root, () => <div>{when(show, () => <span>{other.get()}</span>)}</div>);
    const reads = countReads(show);
    other.set(1);
    expect(reads.n).toBe(0);
    dispose();
  });

  test("a route handler's reads don't re-notify params$", async () => {
    const target = document.createElement("div");
    const theme = signal("light");
    let fires = 0;
    const dispose = routes(target, {
      "/users/:id": (_p, params$) => {
        effect(() => { params$.get(); fires++; });
        return <p class={theme.get()}>x</p>;
      },
    });
    theme.set("dark");
    theme.set("light");
    expect(fires).toBe(1); // before: 3
    dispose();
  });

  test("a component built inside an effect doesn't subscribe that effect to its body's reads", () => {
    const x = signal(0);
    let runs = 0;
    function View() { return <b>{x.get()}</b>; }
    const root = document.createElement("div");
    const dispose = effect(() => { runs++; root.replaceChildren(<View />); });
    x.set(1);
    expect(runs).toBe(1);
    dispose();
  });
});

// ============================================================ a second copy of railroad

describe("a second copy of railroad says so when it loads", () => {
  // Two copies (a linked checkout bringing its own node_modules/@blueshed/railroad) can't see each
  // other's signals, scopes or providers: the UI just stops updating, with nothing on the console.
  test("console.error names both copies and the fix", async () => {
    const { mkdtempSync, copyFileSync } = await import("node:fs");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");
    const dir = mkdtempSync(join(tmpdir(), "railroad-copy-"));
    const first = new URL("./signals.ts", import.meta.url);
    copyFileSync(first, join(dir, "signals.ts"));
    // In a child process, so the copy stays out of this one (and its coverage).
    const run = Bun.spawnSync([process.execPath, "-e",
      `await import(${JSON.stringify(first.pathname)}); await import(${JSON.stringify(join(dir, "signals.ts"))});`]);
    const msg = run.stderr.toString();
    expect(msg).toContain("second copy of @blueshed/railroad");
    expect(msg).toContain(dir); // the new copy
    expect(msg).toContain(first.href); // the first
    expect(msg).toContain("Local development across repos");
  });
});

// ============================================================ React habits that rendered the wrong thing

describe("React habits render what they say", () => {
  test("<select value> selects its option, static or reactive", () => {
    const choice = signal("b");
    const root = document.createElement("div");
    const dispose = mount(root, () => (
      <div>
        <select id="s1" value="b"><option value="a">A</option><option value="b">B</option></select>
        <select id="s2" value={choice}><option value="a">A</option><option value="b">B</option></select>
      </div>
    ));
    const s1 = root.querySelector("#s1") as HTMLSelectElement;
    const s2 = root.querySelector("#s2") as HTMLSelectElement;
    expect(s1.value).toBe("b"); // before: "a", the value was set before any <option> existed
    expect(s2.value).toBe("b");
    choice.set("a");
    expect(s2.value).toBe("a");
    dispose();
  });

  test("a ref sees the element's children", () => {
    let seen = -1;
    createElement("ul", { ref: (el: Element) => { seen = el.childElementCount; } }, <li />, <li />);
    expect(seen).toBe(2);
  });

  test("style objects set CSS custom properties, and clear them", () => {
    const accent = signal<Record<string, string>>({ "--accent": "red", color: "var(--accent)" });
    const el = createElement("div", { style: accent }) as HTMLElement;
    expect(el.style.getPropertyValue("--accent")).toBe("red"); // before: "", dropped
    expect(el.style.color).toBe("var(--accent)");
    accent.set({ color: "blue" });
    expect(el.style.getPropertyValue("--accent")).toBe("");
    const fixed = createElement("div", { style: { "--gap": "4px" } }) as HTMLElement;
    expect(fixed.style.getPropertyValue("--gap")).toBe("4px");
  });

  test("htmlFor writes the for attribute", () => {
    const label = createElement("label", { htmlFor: "x" }) as HTMLLabelElement;
    expect(label.getAttribute("for")).toBe("x"); // before: an attribute named "htmlfor"
    expect(label.htmlFor).toBe("x");
  });

  test("a signal or function child holding null, undefined, true or false renders nothing, as a static one does", () => {
    const v = signal<string | boolean | null | undefined>(null);
    const root = document.createElement("div");
    const dispose = mount(root, () => <p><b>{v}</b><i>{() => v.get()}</i></p>);
    const b = root.querySelector("b")!;
    const i = root.querySelector("i")!;
    for (const empty of [null, undefined, false, true]) {
      v.set(empty);
      expect([b.textContent, i.textContent]).toEqual(["", ""]); // before: "null"/"false"/"true" for a signal, "false"/"true" for a function
    }
    v.set("hi");
    expect([b.textContent, i.textContent]).toEqual(["hi", "hi"]);
    v.set(0 as unknown as string);
    expect([b.textContent, i.textContent]).toEqual(["0", "0"]);
    dispose();
  });
});

// ============================================================ what an effect returns

describe("effect(): only a returned function is a cleanup", () => {
  // Whatever the body returned was stored as the cleanup and called before the next run, so the
  // next write threw "cleanup is not a function" out of the writer's .set().
  test("an async effect is reported where it is created, and the writer doesn't throw", () => {
    const s = signal(0);
    const errorSpy = spyOn(console, "error").mockImplementation(() => {});
    try {
      // @ts-expect-error -- an async callback is what the check is for
      const dispose = effect(async () => { s.get(); });
      expect(errorSpy.mock.calls.some((c) => String(c[0]).includes("must be synchronous"))).toBe(true);
      expect(() => s.set(1)).not.toThrow(); // before: "cleanup is not a function (… Promise)"
      dispose();
    } finally {
      errorSpy.mockRestore();
    }
  });

  test("an expression body's value is not a cleanup", () => {
    const s = signal(0);
    const box = { text: "" };
    // @ts-expect-error -- tsc rejects it; bun runs it anyway
    const dispose = effect(() => (box.text = String(s.get())));
    expect(() => s.set(1)).not.toThrow(); // before: "cleanup is not a function"
    expect(box.text).toBe("1");
    dispose();
  });

  test("a cleanup runs once even when the next run throws", () => {
    const t = signal(0);
    let calls = 0;
    const dispose = effect(() => {
      if (t.get() === 1) throw new Error("second run");
      return () => { calls++; };
    });
    expect(() => t.set(1)).toThrow("second run");
    dispose();
    expect(calls).toBe(1); // before: 2, the thrown run left the old cleanup in place
  });
});

// ============================================================ what "glitch-free" promises

describe("scheduling: a computed that switches what it reads", () => {
  // Pins the documented bound. Glitch-free holds for fixed dependencies (signals.test.ts); a
  // computed that moves to a deeper source can let an effect run once on half-updated values,
  // but every write still settles consistently.
  test("every write settles on consistent values", () => {
    const a = signal(1);
    const flag = signal(false);
    const b = computed(() => a.get() * 2);
    const c = computed(() => (flag.get() ? b.get() : a.get() * 2));
    const seen: string[] = [];
    effect(() => { seen.push(`a=${a.get()} c=${c.get()}`); });
    flag.set(true);
    a.set(2);
    expect(seen.at(-1)).toBe("a=2 c=4");
  });
});

// ============================================================ keyed list(): reorders move only what moved

describe("list(): a reorder moves only the rows that moved", () => {
  // The right-to-left pass moved every row whose successor changed, so moving the last row to
  // the front moved all the others instead, and a focused <input> in one of them lost focus.
  const setup = (ids: number[]) => {
    const items = signal(ids.map((id) => ({ id })));
    const root = document.createElement("div");
    const dispose = mount(root, () => <ul>{list(items, (r) => r.id, (r$) => <li id={`r${r$.peek().id}`} />)}</ul>);
    const ul = root.querySelector("ul")!;
    const moved = new Set<string>();
    const insertBefore = ul.insertBefore.bind(ul);
    ul.insertBefore = ((node: Node, ref: Node | null) => {
      if (node instanceof Element) moved.add(node.id);
      return insertBefore(node, ref);
    }) as typeof ul.insertBefore;
    const ids$ = () => [...ul.querySelectorAll("li")].map((li) => li.id);
    return { items, moved, ids$, dispose };
  };

  test("last to first moves one row", () => {
    const { items, moved, ids$, dispose } = setup([1, 2, 3, 4]);
    items.set([4, 1, 2, 3].map((id) => ({ id })));
    expect(ids$()).toEqual(["r4", "r1", "r2", "r3"]);
    expect([...moved]).toEqual(["r4"]); // before: r3, r2, r1
    dispose();
  });

  test("a swap, a reversal, inserts and removals land in order", () => {
    const { items, moved, ids$, dispose } = setup([1, 2, 3, 4, 5]);
    items.set([1, 4, 3, 2, 5].map((id) => ({ id })));
    expect(ids$()).toEqual(["r1", "r4", "r3", "r2", "r5"]);
    expect(moved.size).toBe(2);
    items.set([5, 4, 3, 2, 1].map((id) => ({ id })));
    expect(ids$()).toEqual(["r5", "r4", "r3", "r2", "r1"]);
    items.set([6, 4, 2, 7, 5].map((id) => ({ id })));
    expect(ids$()).toEqual(["r6", "r4", "r2", "r7", "r5"]);
    dispose();
  });
});

// ============================================================ types that let bugs through

describe("types: a misspelt patch key and a params$ write don't compile", () => {
  // Checked by `bun run check` (tsc over this file): each @ts-expect-error must find its error.
  test(".patch() takes only the signal's own keys", () => {
    const filter = signal({ color: "all", done: false });
    // @ts-expect-error -- "colr" is not a key of the value (it compiled before)
    filter.patch({ colr: "blue" });
    filter.patch({ color: "blue" });
    expect(filter.peek().color).toBe("blue");
  });

  test("a route handler's params$ is read-only", async () => {
    location.hash = "#/users/1";
    await tick();
    const target = document.createElement("div");
    const dispose = routes(target, {
      "/users/:id": (_p, params$) => {
        // @ts-expect-error -- writing params$ would desync it from the URL (it compiled before)
        void params$.set;
        return <p>{params$.map((p) => p.id)}</p>;
      },
    });
    expect(target.textContent).toBe("1");
    dispose();
    location.hash = "";
  });
});

// ============================================================ navigate() is synchronous

describe("navigate(): route() and routes() are current as it returns", () => {
  // navigate() set location.hash and left the route signal to the hashchange a tick later, so a
  // route() read straight after navigate() showed the old path.
  test("route() and the router show the new path before any tick", async () => {
    location.hash = "#/";
    await tick();
    pushDisposeScope();
    const user = route<{ id: string }>("/users/:id");
    const target = document.createElement("div");
    routes(target, {
      "/": () => <p>home</p>,
      "/users/:id": (_p, params$) => <p>{params$.map((p) => p.id)}</p>,
    });
    navigate("/users/7");
    expect(user.get()).toEqual({ id: "7" });
    expect(target.textContent).toBe("7");
    popDisposeScope()();
    location.hash = "";
    await tick();
  });

  test("the hashchange that follows re-runs nothing", async () => {
    location.hash = "#/";
    await tick();
    pushDisposeScope();
    let handlerRuns = 0;
    let paramRuns = 0;
    const target = document.createElement("div");
    routes(target, {
      "/": () => <p>home</p>,
      "/users/:id": (_p, params$) => {
        handlerRuns++;
        effect(() => { params$.get(); paramRuns++; });
        return <p>user</p>;
      },
    });
    navigate("/users/1");
    expect([handlerRuns, paramRuns]).toEqual([1, 1]);
    await tick();
    expect([handlerRuns, paramRuns]).toEqual([1, 1]);
    popDisposeScope()();
    location.hash = "";
    await tick();
  });

  test("a handler that redirects with navigate() lands on the target in the same pass", async () => {
    location.hash = "#/";
    await tick();
    const target = document.createElement("div");
    const dispose = routes(target, {
      "/": () => { navigate("/home"); return <p>root</p>; },
      "/home": () => <p>home</p>,
    });
    expect(target.textContent).toBe("home");
    dispose();
    location.hash = "";
    await tick();
  });

  test("a path the browser percent-encodes fires once, with the encoded value", async () => {
    location.hash = "#/";
    await tick();
    pushDisposeScope();
    const site = route<{ "*": string }>("/sites/*");
    const seen: (string | undefined)[] = [];
    effect(() => { seen.push(site.get()?.["*"]); });
    navigate("/sites/a b");
    await tick();
    expect(seen).toEqual([undefined, "a b"]); // not [undefined, "a b", "a b"]
    popDisposeScope()();
    location.hash = "";
    await tick();
  });
});

describe("routes(): a handler resolving to a bare Promise<Node> is deprecated", () => {
  // Its post-await bindings have no owner scope and outlive the route; the thunk form is the
  // supported one. tsc doesn't print deprecations, so ask the language service, as an editor does.
  test("the editor strikes through routes() for a bare Promise<Node>, not for a thunk", async () => {
    const ts = (await import("typescript")).default;
    const dir = new URL(".", import.meta.url).pathname;
    const probe = dir + "__deprecation_probe.tsx";
    const lines = [
      'import { createElement } from "./jsx";',
      'import { routes } from "./routes";',
      "declare const el: Element;",
      'routes(el, { "/": () => <p />, "/a": async () => { await null; return () => <p />; } });',
      'routes(el, { "/": () => <p />, "/b": async () => { await null; return <p />; } });',
    ];
    const cfg = ts.getParsedCommandLineOfConfigFile(dir + "tsconfig.json", {}, {
      ...ts.sys,
      onUnRecoverableConfigFileDiagnostic: () => {},
    })!;
    const service = ts.createLanguageService({
      getScriptFileNames: () => [probe],
      getScriptVersion: () => "1",
      getScriptSnapshot: (f) => f === probe
        ? ts.ScriptSnapshot.fromString(lines.join("\n"))
        : ts.sys.fileExists(f) ? ts.ScriptSnapshot.fromString(ts.sys.readFile(f)!) : undefined,
      getCurrentDirectory: () => dir,
      getCompilationSettings: () => cfg.options,
      getDefaultLibFileName: ts.getDefaultLibFilePath,
      fileExists: (f) => f === probe || ts.sys.fileExists(f),
      readFile: (f) => f === probe ? lines.join("\n") : ts.sys.readFile(f),
    });
    expect(service.getSemanticDiagnostics(probe).map((d) => d.code)).toEqual([]);
    const deprecated = service.getSuggestionDiagnostics(probe)
      .filter((d) => d.code === 6387) // "The signature … is deprecated"
      .map((d) => d.file!.getLineAndCharacterOfPosition(d.start!).line + 1);
    expect(deprecated).toEqual([5]); // the bare Promise<Node> only
  }, 30_000);
});

describe("types: railroad declares no global JSX", () => {
  // jsx.ts declared `global { namespace JSX }`, which clashed with React's in a mixed app (TS2300
  // Duplicate identifier 'Element'), through the root barrel, /jsx, /routes and /jsx-runtime.
  // `bun run check` compiles this file under jsx: react; tests/consumer-types covers both modes.
  test("the factory's namespace types JSX, and the global has none", () => {
    // @ts-expect-error -- no global JSX namespace; import the type instead
    type Global = globalThis.JSX.Element;
    const el: JSX.Element = <p>x</p>;
    expect(el).toBeInstanceOf(Node);
  });
});
