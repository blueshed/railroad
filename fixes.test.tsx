// Regression tests for the v0.9.x fix sets — each pins a bug found in a deep
// review (and several load-bearing invariants that previously had no test).
import { describe, test, expect, spyOn, beforeEach, afterEach } from "bun:test";
import { createElement, Fragment, when, list } from "./jsx";
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
  beforeEach(() => { document.body.innerHTML = ""; });

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
