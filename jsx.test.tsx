import { describe, test, expect } from "bun:test";
import { createElement, when, list } from "./jsx";
import { signal } from "./signals";

const SVG_NS = "http://www.w3.org/2000/svg";

function flushMicrotasks(): Promise<void> {
  return new Promise((r) => queueMicrotask(r));
}

describe("SVG namespace adoption inside list() and when()", () => {
  test("list() inside <svg> adopts children to SVG namespace", async () => {
    document.body.innerHTML = "";
    const items = signal<{ id: number }[]>([{ id: 1 }]);
    const svg = (
      <svg>
        {list(items, (i: { id: number }) => i.id, () => <circle r="10" />)}
      </svg>
    ) as SVGElement;
    document.body.append(svg);
    await flushMicrotasks();

    const circle = svg.querySelector("circle")!;
    expect(circle).not.toBeNull();
    expect(circle.namespaceURI).toBe(SVG_NS);
  });

  test("when() inside <svg> adopts children to SVG namespace", async () => {
    document.body.innerHTML = "";
    const flag = signal(true);
    const svg = (
      <svg>
        {when(flag, () => <circle r="10" />)}
      </svg>
    ) as SVGElement;
    document.body.append(svg);
    await flushMicrotasks();

    const circle = svg.querySelector("circle")!;
    expect(circle).not.toBeNull();
    expect(circle.namespaceURI).toBe(SVG_NS);
  });

  test("list() adopts children after insert, remove, and reorder", async () => {
    document.body.innerHTML = "";
    type Item = { id: number; fill: string };
    const items = signal<Item[]>([
      { id: 1, fill: "red" },
      { id: 2, fill: "blue" },
    ]);
    const svg = (
      <svg>
        {list(
          items,
          (i: Item) => i.id,
          (i$) => {
            const v = i$.get();
            return <circle r="10" fill={v.fill} data-id={String(v.id)} />;
          },
        )}
      </svg>
    ) as SVGElement;
    document.body.append(svg);
    await flushMicrotasks();

    let circles = [...svg.querySelectorAll("circle")];
    expect(circles).toHaveLength(2);
    expect(circles.every((c) => c.namespaceURI === SVG_NS)).toBe(true);
    expect(circles.map((c) => c.getAttribute("data-id"))).toEqual(["1", "2"]);

    // Append a new item — the new one must be adopted too.
    items.set([
      { id: 1, fill: "red" },
      { id: 2, fill: "blue" },
      { id: 3, fill: "green" },
    ]);
    await flushMicrotasks();

    circles = [...svg.querySelectorAll("circle")];
    expect(circles).toHaveLength(3);
    expect(circles.every((c) => c.namespaceURI === SVG_NS)).toBe(true);

    // Remove a middle item — the retained DOM nodes must actually be
    // removed (regression check: adoption-at-insert would leave them).
    items.set([
      { id: 1, fill: "red" },
      { id: 3, fill: "green" },
    ]);
    await flushMicrotasks();

    circles = [...svg.querySelectorAll("circle")];
    expect(circles.map((c) => c.getAttribute("data-id"))).toEqual(["1", "3"]);

    // Reorder — existing entries must be moved (not duplicated).
    items.set([
      { id: 3, fill: "green" },
      { id: 1, fill: "red" },
    ]);
    await flushMicrotasks();

    circles = [...svg.querySelectorAll("circle")];
    expect(circles).toHaveLength(2);
    expect(circles.every((c) => c.namespaceURI === SVG_NS)).toBe(true);
    expect(circles.map((c) => c.getAttribute("data-id"))).toEqual(["3", "1"]);
  });

  test("list() index-based recreate path adopts on re-render", async () => {
    document.body.innerHTML = "";
    const items = signal<string[]>(["a", "b"]);
    const svg = (
      <svg>
        {list(items, (text: string) => (<text>{text}</text>) as Node)}
      </svg>
    ) as SVGElement;
    document.body.append(svg);
    await flushMicrotasks();

    let texts = [...svg.querySelectorAll("text")];
    expect(texts).toHaveLength(2);
    expect(texts.every((t) => t.namespaceURI === SVG_NS)).toBe(true);

    // Mutate — index-based path disposes old entry and recreates.
    items.set(["x", "y", "z"]);
    await flushMicrotasks();

    texts = [...svg.querySelectorAll("text")];
    expect(texts).toHaveLength(3);
    expect(texts.every((t) => t.namespaceURI === SVG_NS)).toBe(true);
    expect(texts.map((t) => t.textContent)).toEqual(["x", "y", "z"]);
  });

  test("when() swaps branches and keeps SVG namespace", async () => {
    document.body.innerHTML = "";
    const flag = signal(true);
    const svg = (
      <svg>
        {when(
          flag,
          () => <circle r="10" data-kind="circle" />,
          () => <rect width="10" height="10" data-kind="rect" />,
        )}
      </svg>
    ) as SVGElement;
    document.body.append(svg);
    await flushMicrotasks();

    expect(svg.querySelector("[data-kind=circle]")?.namespaceURI).toBe(SVG_NS);
    expect(svg.querySelector("[data-kind=rect]")).toBeNull();

    flag.set(false);
    await flushMicrotasks();

    expect(svg.querySelector("[data-kind=circle]")).toBeNull();
    const rect = svg.querySelector("[data-kind=rect]");
    expect(rect).not.toBeNull();
    expect(rect!.namespaceURI).toBe(SVG_NS);

    flag.set(true);
    await flushMicrotasks();

    expect(svg.querySelector("[data-kind=rect]")).toBeNull();
    expect(svg.querySelector("[data-kind=circle]")?.namespaceURI).toBe(SVG_NS);
  });

  test("list() of nested SVG subtrees adopts recursively", async () => {
    document.body.innerHTML = "";
    const items = signal<{ id: number }[]>([{ id: 1 }]);
    const svg = (
      <svg>
        {list(items, (i: { id: number }) => i.id, () => (
          <g>
            <circle r="5" />
          </g>
        ))}
      </svg>
    ) as SVGElement;
    document.body.append(svg);
    await flushMicrotasks();

    const g = svg.querySelector("g")!;
    const circle = svg.querySelector("circle")!;
    expect(g.namespaceURI).toBe(SVG_NS);
    expect(circle.namespaceURI).toBe(SVG_NS);
    expect(circle.parentNode).toBe(g);
  });

  test("already-SVG children (createElementNS) pass through unchanged", async () => {
    document.body.innerHTML = "";
    const items = signal<{ id: number }[]>([{ id: 1 }]);
    const svg = (
      <svg>
        {list(items, (i: { id: number }) => i.id, () => {
          // Caller builds SVG by hand — must not be re-adopted.
          return document.createElementNS(SVG_NS, "circle");
        })}
      </svg>
    ) as SVGElement;
    document.body.append(svg);
    await flushMicrotasks();

    const circle = svg.querySelector("circle")!;
    expect(circle.namespaceURI).toBe(SVG_NS);
  });

  test("non-SVG parent is unaffected", async () => {
    document.body.innerHTML = "";
    const items = signal<{ id: number }[]>([{ id: 1 }, { id: 2 }]);
    const div = (
      <div>
        {list(items, (i: { id: number }) => i.id, () => <span>hi</span>)}
      </div>
    ) as HTMLElement;
    document.body.append(div);
    await flushMicrotasks();

    const spans = [...div.querySelectorAll("span")];
    expect(spans).toHaveLength(2);
    // HTML XHTML namespace under happy-dom is the HTML namespace.
    expect(spans.every((s) => s.namespaceURI !== SVG_NS)).toBe(true);
  });
});

describe("reactive props", () => {
  test("Signal value prop updates input.value", () => {
    document.body.innerHTML = "";
    const v = signal("hello");
    const input = (<input type="text" value={v} />) as HTMLInputElement;
    document.body.append(input);
    expect(input.value).toBe("hello");
    v.set("world");
    expect(input.value).toBe("world");
  });

  test("Signal checked prop updates input.checked", () => {
    document.body.innerHTML = "";
    const c = signal(false);
    const input = (<input type="checkbox" checked={c} />) as HTMLInputElement;
    document.body.append(input);
    expect(input.checked).toBe(false);
    c.set(true);
    expect(input.checked).toBe(true);
  });

  test("Signal disabled prop updates button.disabled", () => {
    document.body.innerHTML = "";
    const d = signal(false);
    const btn = (<button disabled={d}>x</button>) as HTMLButtonElement;
    document.body.append(btn);
    expect(btn.disabled).toBe(false);
    d.set(true);
    expect(btn.disabled).toBe(true);
  });

  test("Signal class prop updates the element's class", () => {
    document.body.innerHTML = "";
    const cls = signal("a");
    const div = (<div class={cls}>x</div>) as HTMLDivElement;
    document.body.append(div);
    expect(div.getAttribute("class")).toBe("a");
    cls.set("a b");
    expect(div.getAttribute("class")).toBe("a b");
  });

  test("Signal generic attribute updates and removes on falsy/null", () => {
    document.body.innerHTML = "";
    const t = signal<string | null | false>("hello");
    const div = (<div title={t}>x</div>) as HTMLDivElement;
    document.body.append(div);
    expect(div.getAttribute("title")).toBe("hello");

    t.set("world");
    expect(div.getAttribute("title")).toBe("world");

    t.set(null);
    expect(div.hasAttribute("title")).toBe(false);

    t.set("back");
    expect(div.getAttribute("title")).toBe("back");

    t.set(false);
    expect(div.hasAttribute("title")).toBe(false);
  });

  test("Signal style prop merges into element.style", () => {
    document.body.innerHTML = "";
    const sty = signal({ color: "red", fontSize: "10px" });
    const div = (<div style={sty}>x</div>) as HTMLDivElement;
    document.body.append(div);
    expect(div.style.color).toBe("red");
    expect(div.style.fontSize).toBe("10px");

    sty.set({ color: "blue", fontSize: "12px" });
    expect(div.style.color).toBe("blue");
    expect(div.style.fontSize).toBe("12px");
  });

  test("Signal style prop clears stale properties when keys are omitted", () => {
    document.body.innerHTML = "";
    const sty = signal<Record<string, string>>({ color: "red", fontSize: "10px" });
    const div = (<div style={sty}>x</div>) as HTMLDivElement;
    document.body.append(div);
    expect(div.style.color).toBe("red");
    expect(div.style.fontSize).toBe("10px");

    sty.set({ color: "blue" });
    expect(div.style.color).toBe("blue");
    expect(div.style.fontSize).toBe("");
  });

  test("Signal innerHTML prop updates element.innerHTML", () => {
    document.body.innerHTML = "";
    const html = signal("<span>a</span>");
    const div = (<div innerHTML={html} />) as HTMLDivElement;
    document.body.append(div);
    expect(div.querySelector("span")?.textContent).toBe("a");

    html.set("<em>b</em>");
    expect(div.querySelector("em")?.textContent).toBe("b");
  });

  test("Signal as a child node updates text content", () => {
    document.body.innerHTML = "";
    const s = signal("hello");
    const span = (<span>{s}</span>) as HTMLSpanElement;
    document.body.append(span);
    expect(span.textContent).toBe("hello");
    s.set("bye");
    expect(span.textContent).toBe("bye");
  });

  test("function child auto-tracks signal reads", () => {
    document.body.innerHTML = "";
    const n = signal(3);
    const span = (<span>{() => n.get() * 2}</span>) as HTMLSpanElement;
    document.body.append(span);
    expect(span.textContent).toBe("6");
    n.set(5);
    expect(span.textContent).toBe("10");
  });

  test("event handler fires", () => {
    document.body.innerHTML = "";
    let clicks = 0;
    const btn = (<button onclick={() => { clicks++; }}>x</button>) as HTMLButtonElement;
    document.body.append(btn);
    btn.click();
    btn.click();
    expect(clicks).toBe(2);
  });

  test("ref callback receives the element", () => {
    document.body.innerHTML = "";
    const captured: { el: Element | null } = { el: null };
    const div = (<div ref={(el: Element) => { captured.el = el; }} />) as HTMLDivElement;
    document.body.append(div);
    expect(captured.el).toBe(div);
  });
});

describe("when() and list() composition", () => {
  test("nested when() inside list() — toggles per-item without re-creating the list entry", async () => {
    document.body.innerHTML = "";
    type Item = { id: number; open: boolean };
    const items = signal<Item[]>([
      { id: 1, open: false },
      { id: 2, open: false },
    ]);
    const root = (
      <ul>
        {list(items, (i: Item) => i.id, (i$) => {
          const open = i$.map((i) => i.open);
          return (
            <li data-id={String(i$.peek().id)}>
              {when(open, () => <span class="body">open</span>)}
            </li>
          );
        })}
      </ul>
    ) as HTMLElement;
    document.body.append(root);
    await flushMicrotasks();

    const li1 = root.querySelector('[data-id="1"]')!;
    expect(li1.querySelector(".body")).toBeNull();

    items.set([
      { id: 1, open: true },
      { id: 2, open: false },
    ]);
    await flushMicrotasks();
    expect(li1.querySelector(".body")?.textContent).toBe("open");

    items.set([
      { id: 1, open: false },
      { id: 2, open: false },
    ]);
    await flushMicrotasks();
    expect(li1.querySelector(".body")).toBeNull();
  });
});
