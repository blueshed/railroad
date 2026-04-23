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
