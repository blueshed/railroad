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
} from "./signals";
import type { ReadonlySignal } from "./signals";
import { routes, navigate, matchRoute } from "./routes";
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
      warnSpy.mock.calls.some((c) => String(c[0]).includes("function child returned a DOM Node")),
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

// ============================================================ deferred-swap dispose guard & row bracket ranges

describe("when()/list(): post-dispose deferred swaps and row brackets", () => {
  beforeEach(() => { document.body.innerHTML = ""; });

  test("when(): a scope disposed before the deferred first swap never builds the branch", async () => {
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
    dispose(); // same tick — the first swap() microtask is still queued
    await flush();
    expect(builds).toBe(0); // the queued swap must be a no-op after dispose
    dep.set(1); // and no orphaned branch effect can be left responding
    expect(branchRuns).toBe(0);
  });

  test("list(): a scope disposed before the deferred first sync never builds rows", async () => {
    const rows = signal([{ id: 1 }, { id: 2 }]);
    let builds = 0;
    const root = document.createElement("div");
    document.body.append(root);
    // Nested one element deep: after dispose the list anchor still has a
    // (detached) parent, so only the disposed guard prevents the rebuild.
    const dispose = mount(root, () => (
      <ul>{list(rows, (r) => r.id, () => { builds++; return <li />; })}</ul>
    ));
    dispose();
    await flush();
    expect(builds).toBe(0);
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
    await tick(); // list sync, then each row's deferred when() swap
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
