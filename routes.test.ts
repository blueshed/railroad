import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { routes, route, navigate } from "./routes";
import { effect, signal } from "./signals";

function tick(): Promise<void> {
  // happy-dom dispatches `hashchange` on the next macrotask, not as a
  // microtask — `await new Promise(setTimeout)` covers both.
  return new Promise((r) => setTimeout(r, 0));
}

function defer<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

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

    const d = defer<Node>();
    const dispose = routes(target, {
      "/slow": () => d.promise,
    });
    expect(target.children.length).toBe(0);

    const el = document.createElement("span");
    el.textContent = "loaded";
    d.resolve(el);
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

    const slow = defer<Node>();
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
    slow.resolve(stale);
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

    const d = defer<Node>();
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

// Touch suppress-unused warnings for imports the test file references.
void signal;
