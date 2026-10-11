import { describe, test, expect, spyOn, beforeEach, afterEach } from "bun:test";
import { signal, effect, pushDisposeScope, popDisposeScope, trackDispose } from "./signals";
import { createElement, when, Fragment } from "./jsx";
import { routes, route, navigate, matchRoute } from "./routes";
import { SVG_NS, tick, defer } from "./tests/helpers";

beforeEach(() => {
  document.body.innerHTML = "";
  location.hash = "";
});

afterEach(() => {
  location.hash = "";
});

describe("routes()", () => {
  test("renders the matching handler synchronously", async () => {
    const target = document.createElement("div");
    document.body.append(target);
    location.hash = "#/about";
    await tick();

    const dispose = routes(target, {
      "/": () => {
        const el = document.createElement("div");
        el.textContent = "home";
        return el;
      },
      "/about": () => {
        const el = document.createElement("div");
        el.textContent = "about";
        return el;
      },
    });

    expect(target.textContent).toBe("about");
    dispose();
  });

  test("swaps content on hash change", async () => {
    const target = document.createElement("div");
    document.body.append(target);
    location.hash = "#/";
    await tick();

    const dispose = routes(target, {
      "/": () => {
        const el = document.createElement("span");
        el.textContent = "home";
        return el;
      },
      "/about": () => {
        const el = document.createElement("span");
        el.textContent = "about";
        return el;
      },
    });
    expect(target.textContent).toBe("home");

    navigate("/about");
    await tick();
    expect(target.textContent).toBe("about");

    dispose();
  });

  test("clears target when no pattern matches", async () => {
    const target = document.createElement("div");
    document.body.append(target);
    location.hash = "#/";
    await tick();

    const dispose = routes(target, {
      "/": () => {
        const el = document.createElement("p");
        el.textContent = "home";
        return el;
      },
    });
    expect(target.textContent).toBe("home");

    navigate("/nope");
    await tick();
    expect(target.children.length).toBe(0);

    dispose();
  });

  test("params$ updates within the same pattern without re-render", async () => {
    const target = document.createElement("div");
    document.body.append(target);
    location.hash = "#/users/1";
    await tick();

    let renders = 0;
    const dispose = routes(target, {
      "/users/:id": (_p, params$) => {
        renders++;
        const el = document.createElement("span");
        effect(() => { el.textContent = params$.get().id ?? ""; });
        return el;
      },
    });
    expect(renders).toBe(1);
    expect(target.textContent).toBe("1");

    navigate("/users/2");
    await tick();
    expect(renders).toBe(1); // same pattern — no re-render
    expect(target.textContent).toBe("2");

    navigate("/users/42");
    await tick();
    expect(renders).toBe(1);
    expect(target.textContent).toBe("42");

    dispose();
  });

  test("changing pattern tears down and re-renders", async () => {
    const target = document.createElement("div");
    document.body.append(target);
    location.hash = "#/users/1";
    await tick();

    let cleanups = 0;
    const dispose = routes(target, {
      "/users/:id": () => {
        const el = document.createElement("span");
        el.textContent = "user";
        effect(() => () => { cleanups++; });
        return el;
      },
      "/about": () => {
        const el = document.createElement("span");
        el.textContent = "about";
        return el;
      },
    });
    expect(target.textContent).toBe("user");

    navigate("/about");
    await tick();
    expect(target.textContent).toBe("about");
    expect(cleanups).toBe(1);

    dispose();
  });

  test("async handler resolves and renders", async () => {
    const target = document.createElement("div");
    document.body.append(target);
    location.hash = "#/slow";
    await tick();

    const d = defer<() => Node>();
    const dispose = routes(target, {
      "/slow": () => d.promise,
    });
    expect(target.children.length).toBe(0);

    const el = document.createElement("span");
    el.textContent = "loaded";
    d.resolve(() => el);
    await d.promise;
    await tick();
    expect(target.textContent).toBe("loaded");

    dispose();
  });

  test("async race — navigation during await discards stale result", async () => {
    const target = document.createElement("div");
    document.body.append(target);
    location.hash = "#/slow";
    await tick();

    const slow = defer<() => Node>();
    const dispose = routes(target, {
      "/slow": () => slow.promise,
      "/fast": () => {
        const el = document.createElement("span");
        el.textContent = "fast";
        return el;
      },
    });

    // Navigate away before the slow handler resolves.
    navigate("/fast");
    await tick();
    expect(target.textContent).toBe("fast");

    // Resolve the stale promise — it must NOT replace the current content.
    const stale = document.createElement("span");
    stale.textContent = "slow";
    slow.resolve(() => stale);
    await slow.promise;
    await tick();
    expect(target.textContent).toBe("fast");

    dispose();
  });

  test("synchronous handler error keeps the router alive and logs", async () => {
    const target = document.createElement("div");
    document.body.append(target);
    location.hash = "#/boom";
    await tick();

    const origError = console.error;
    const calls: unknown[][] = [];
    console.error = (...args: unknown[]) => { calls.push(args); };

    const dispose = routes(target, {
      "/boom": () => { throw new Error("kaboom"); },
      "/ok": () => {
        const el = document.createElement("span");
        el.textContent = "ok";
        return el;
      },
    });
    // Handler threw, target stays empty, router did not crash.
    expect(target.children.length).toBe(0);
    expect(calls.length).toBe(1);
    expect(String(calls[0]?.[0])).toContain("handler threw");

    // Navigate to a working route — the router must still respond.
    navigate("/ok");
    await tick();
    expect(target.textContent).toBe("ok");

    dispose();
    console.error = origError;
  });

  test("synchronous handler error boundary renders fallback view", async () => {
    const target = document.createElement("div");
    document.body.append(target);
    location.hash = "#/boom";
    await tick();

    const dispose = routes(
      target,
      {
        "/boom": () => { throw new Error("kaboom"); },
      },
      {
        onError: (err) => {
          const el = document.createElement("div");
          el.textContent = `Error: ${(err as Error).message}`;
          return el;
        },
      }
    );

    expect(target.textContent).toBe("Error: kaboom");
    dispose();
  });

  test("async handler error boundary renders fallback view", async () => {
    const target = document.createElement("div");
    document.body.append(target);
    location.hash = "#/slow-boom";
    await tick();

    const d = defer<() => Node>();
    const dispose = routes(
      target,
      {
        "/slow-boom": () => d.promise,
      },
      {
        onError: (err) => {
          const el = document.createElement("div");
          el.textContent = `Error: ${(err as Error).message}`;
          return el;
        },
      }
    );

    d.reject(new Error("async kaboom"));
    try {
      await d.promise;
    } catch {}
    await tick();

    expect(target.textContent).toBe("Error: async kaboom");
    dispose();
  });

  test("dispose stack stays balanced after handler throw", async () => {
    // Direct guarantee: popDisposeScope now throws on imbalance, so any leak
    // from the previous test would crash this one's first effect call.
    const target = document.createElement("div");
    document.body.append(target);
    location.hash = "#/x";
    await tick();

    const dispose = routes(target, {
      "/x": () => {
        const el = document.createElement("span");
        el.textContent = "x";
        return el;
      },
    });
    expect(target.textContent).toBe("x");
    dispose();
  });

  test("dispose() removes the hashchange listener and clears target", async () => {
    const target = document.createElement("div");
    document.body.append(target);
    location.hash = "#/";
    await tick();

    const dispose = routes(target, {
      "/": () => {
        const el = document.createElement("span");
        el.textContent = "home";
        return el;
      },
      "/about": () => {
        const el = document.createElement("span");
        el.textContent = "about";
        return el;
      },
    });
    expect(target.textContent).toBe("home");

    dispose();
    expect(target.children.length).toBe(0);

    // After dispose, hashchange must not re-render.
    navigate("/about");
    await tick();
    expect(target.children.length).toBe(0);
  });

  test("nested routes via wildcard — outer stays mounted", async () => {
    const target = document.createElement("div");
    document.body.append(target);
    location.hash = "#/sites/1";
    await tick();

    let outerRenders = 0;
    const dispose = routes(target, {
      "/sites/*": () => {
        outerRenders++;
        const wrapper = document.createElement("div");
        wrapper.setAttribute("data-layout", "sites");
        return wrapper;
      },
    });
    expect(outerRenders).toBe(1);
    expect(target.querySelector("[data-layout=sites]")).not.toBeNull();

    navigate("/sites/2/edit");
    await tick();
    // Same wildcard pattern — no re-render of outer layout.
    expect(outerRenders).toBe(1);

    dispose();
  });
});

describe("routes(): async handlers, double dispose and onError", () => {
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
        return () => el;
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
    const deferreds = new Map<string, ReturnType<typeof defer<() => Node>>>();
    const dispose = routes(target, {
      "/users/:id": (params) => {
        const id = params.id!;
        calls.push(id);
        const d = defer<() => Node>();
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
    deferreds.get("1")!.resolve(() => stale);
    // Resolve "2" — it should paint.
    const fresh = document.createElement("span"); fresh.textContent = "user 2";
    deferreds.get("2")!.resolve(() => fresh);
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

    const d = defer<() => Node>();
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
});

describe("routes(): a keyed route re-runs its handler when the params change", () => {
  // A handler runs once per pattern, so `({ id }) => …` kept the first id after /users/1 → /users/2.
  // `{ keyed: true, handler }` re-runs it, as Solid's <Show keyed> does.
  test("/users/1 → /users/2 re-runs a keyed handler and disposes the old run", async () => {
    location.hash = "#/users/1";
    await tick();
    const target = document.createElement("div");
    const runs: string[] = [];
    let live = 0;
    const dispose = routes(target, {
      "/users/:id": {
        keyed: true,
        handler: ({ id }) => {
          runs.push(id!);
          live++;
          trackDispose(() => live--);
          return <h1>user {id}</h1>;
        },
      },
      "/plain/:id": { handler: ({ id }) => <h2>{id}</h2> },
    });
    expect(target.textContent).toBe("user 1");
    navigate("/users/2");
    expect(target.textContent).toBe("user 2");
    expect(runs).toEqual(["1", "2"]);
    expect(live).toBe(1);
    // An entry without keyed runs once per pattern, as a bare handler does.
    navigate("/plain/1");
    navigate("/plain/2");
    expect(target.textContent).toBe("1");
    dispose();
    expect(live).toBe(0);
    location.hash = "";
    await tick();
  });

  test("a new path with the same params doesn't re-run it", async () => {
    location.hash = "#/";
    await tick();
    const target = document.createElement("div");
    let runs = 0;
    const dispose = routes(target, {
      "/": () => <p>home</p>,
      "/tags/:tag": { keyed: true, handler: ({ tag }) => { runs++; return <p>{tag}</p>; } },
    });
    navigate("/tags/%zz"); // a malformed escape stays raw: "%zz"
    navigate("/tags/%25zz"); // decodes to "%zz" too
    expect(target.textContent).toBe("%zz");
    expect(runs).toBe(1);
    dispose();
    location.hash = "";
    await tick();
  });
});

describe("routes(): a handler resolving to a bare Node is an error", () => {
  // What it built after its first await would have no owner scope and outlive the route; a
  // thunk gives railroad a synchronous moment to own it. Deprecated in 0.14.0, removed in 0.16.0.
  test("it doesn't compile, and at run time goes to onError with the fix named", async () => {
    location.hash = "#/";
    await tick();
    const target = document.createElement("div");
    const errors: unknown[] = [];
    const name = signal("a");
    let effectRuns = 0;
    const dispose = routes(target, {
      // @ts-expect-error -- a bare Promise<Node> is not a route handler (it compiled, deprecated, before)
      "/": async () => {
        effect(() => { name.get(); effectRuns++; }); // made before the await: the handler's scope
        await null;
        return <p>bare</p>;
      },
    }, { onError: (err) => { errors.push(err); return <p>failed</p>; } });
    await tick();
    expect(target.textContent).toBe("failed");
    expect(String(errors[0])).toContain("resolved to a Node");
    expect(String(errors[0])).toContain("return () => <div>…</div>");
    name.set("b");
    expect(effectRuns).toBe(1); // the handler's scope was disposed with the failure
    dispose();
    location.hash = "";
  });
});

describe("types: a route handler's params$ is read-only", () => {
  // Checked by `bun run check` (tsc over this file): the @ts-expect-error must find its error.
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

describe("route()", () => {
  test("returns matching params, null when unmatched", async () => {
    location.hash = "#/users/7";
    await tick();
    const r = route<{ id: string }>("/users/:id");
    expect(r.get()).toEqual({ id: "7" });

    navigate("/about");
    await tick();
    expect(r.get()).toBeNull();

    navigate("/users/99");
    await tick();
    expect(r.get()).toEqual({ id: "99" });
  });

  test("multiple route() instances share the hash signal", async () => {
    location.hash = "#/users/1";
    await tick();
    const a = route<{ id: string }>("/users/:id");
    const b = route<{ id: string }>("/users/:id");
    expect(a.get()).toEqual({ id: "1" });
    expect(b.get()).toEqual({ id: "1" });

    navigate("/users/2");
    await tick();
    expect(a.get()).toEqual({ id: "2" });
    expect(b.get()).toEqual({ id: "2" });
  });

  test("effect on route() re-runs when params change", async () => {
    location.hash = "#/posts/1";
    await tick();
    const r = route<{ id: string }>("/posts/:id");
    const seen: (string | null)[] = [];
    const dispose = effect(() => { seen.push(r.get()?.id ?? null); });
    expect(seen).toEqual(["1"]);

    navigate("/posts/2");
    await tick();
    expect(seen).toEqual(["1", "2"]);

    navigate("/about");
    await tick();
    expect(seen).toEqual(["1", "2", null]);

    dispose();
  });
});

describe("navigate()", () => {
  test("sets location.hash and triggers reactive update", async () => {
    location.hash = "#/";
    await tick();

    const r = route("/about");
    expect(r.get()).toBeNull();

    navigate("/about");
    await tick();
    expect(r.get()).toEqual({});
    expect(location.hash).toBe("#/about");
  });
});

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

// Touch suppress-unused warnings for imports the test file references.
void signal;

// A handler's <a> placed in an <svg> target is adopted (created afresh, its props applied again),
// inside the handler's scope: its props live as long as the route (todo #9).
describe("routes() into an <svg>: an adopted <a> keeps its props for as long as the route", () => {
  test("a sync handler's, through a change of params", async () => {
    location.hash = "#/u/1";
    await tick();
    const href = signal("#1");
    const svg = document.createElementNS(SVG_NS, "svg");
    const dispose = routes(svg, { "/u/:id": () => createElement("a", { href }, "x") });
    expect(svg.querySelector("a")!.namespaceURI).toBe(SVG_NS);
    navigate("/u/2"); // same pattern: params$ moves, the router's effect runs again
    href.set("#2");
    expect(svg.querySelector("a")!.getAttribute("href")).toBe("#2"); // before: "#1"
    dispose();
  });

  test("an async handler's thunk, and gone on navigation", async () => {
    location.hash = "#/a";
    await tick();
    const href = signal("#1");
    const svg = document.createElementNS(SVG_NS, "svg");
    const dispose = routes(svg, {
      "/a": async () => {
        await null;
        return () => createElement("a", { href }, "x");
      },
      "/b": () => createElement("g", null),
    });
    await tick();
    const a = svg.querySelector("a")!;
    expect(a.namespaceURI).toBe(SVG_NS);
    href.set("#2");
    expect(a.getAttribute("href")).toBe("#2");
    navigate("/b");
    href.set("#3");
    expect(a.getAttribute("href")).toBe("#2"); // before: "#3", it outlived the route
    dispose();
  });
});

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

describe("matchRoute", () => {

  test("exact match", () => {
    expect(matchRoute("/", "/")).toEqual({});
    expect(matchRoute("/about", "/about")).toEqual({});
  });

  test("no match", () => {
    expect(matchRoute("/about", "/")).toBeNull();
    expect(matchRoute("/", "/about")).toBeNull();
  });

  test("params", () => {
    expect(matchRoute("/users/:id", "/users/42")).toEqual({ id: "42" });
  });

  test("multiple params", () => {
    expect(matchRoute("/users/:id/posts/:pid", "/users/1/posts/99"))
      .toEqual({ id: "1", pid: "99" });
  });

  test("decodes URI components", () => {
    expect(matchRoute("/search/:q", "/search/hello%20world"))
      .toEqual({ q: "hello world" });
  });

  test("wildcard matches rest of path", () => {
    expect(matchRoute("/sites/*", "/sites/42/settings"))
      .toEqual({ "*": "42/settings" });
  });

  test("wildcard matches empty rest", () => {
    expect(matchRoute("/sites/*", "/sites"))
      .toEqual({ "*": "" });
  });

  test("wildcard matches single segment", () => {
    expect(matchRoute("/sites/*", "/sites/42"))
      .toEqual({ "*": "42" });
  });

  test("wildcard with params", () => {
    expect(matchRoute("/sites/:id/*", "/sites/42/settings/advanced"))
      .toEqual({ id: "42", "*": "settings/advanced" });
  });

  test("wildcard does not match wrong prefix", () => {
    expect(matchRoute("/sites/*", "/other/stuff")).toBeNull();
  });

  test("catch-all wildcard", () => {
    expect(matchRoute("/*", "/anything/here"))
      .toEqual({ "*": "anything/here" });
  });

  test("matchRoute keeps the raw segment when a :param has a malformed escape", () => {
    expect(matchRoute("/u/:id", "/u/%zz")).toEqual({ id: "%zz" });
  });
});
