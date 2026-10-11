import { describe, test, expect, spyOn, beforeEach, afterEach, mock } from "bun:test";
import { signal, effect, untrack, pushDisposeScope, popDisposeScope, trackDispose, hasActiveDisposeScope } from "./signals";
import type { ReadonlySignal } from "./signals";
import { createElement, when, list, mount, Fragment } from "./jsx";
import type { JSX } from "./jsx";
import { routes } from "./routes";
import { SVG_NS, tick, flush, defer } from "./tests/helpers";

// when()/list() warn when created outside a dispose scope; bracket each test
// in one (as a component or mount() would) and tear it down afterwards.
const scoped = () => {
  beforeEach(() => { pushDisposeScope(); });
  afterEach(() => { popDisposeScope()(); });
};

describe("SVG namespace adoption inside list() and when()", () => {
  scoped();
  test("list() inside <svg> adopts children to SVG namespace", async () => {
    document.body.innerHTML = "";
    const items = signal<{ id: number }[]>([{ id: 1 }]);
    const svg = (
      <svg>
        {list(items, (i: { id: number }) => i.id, () => <circle r="10" />)}
      </svg>
    ) as SVGElement;
    document.body.append(svg);
    await flush();

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
    await flush();

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
            const v = i$.peek();
            return <circle r="10" fill={v.fill} data-id={String(v.id)} />;
          },
        )}
      </svg>
    ) as SVGElement;
    document.body.append(svg);
    await flush();

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
    await flush();

    circles = [...svg.querySelectorAll("circle")];
    expect(circles).toHaveLength(3);
    expect(circles.every((c) => c.namespaceURI === SVG_NS)).toBe(true);

    // Remove a middle item — the retained DOM nodes must actually be
    // removed (regression check: adoption-at-insert would leave them).
    items.set([
      { id: 1, fill: "red" },
      { id: 3, fill: "green" },
    ]);
    await flush();

    circles = [...svg.querySelectorAll("circle")];
    expect(circles.map((c) => c.getAttribute("data-id"))).toEqual(["1", "3"]);

    // Reorder — existing entries must be moved (not duplicated).
    items.set([
      { id: 3, fill: "green" },
      { id: 1, fill: "red" },
    ]);
    await flush();

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
    await flush();

    let texts = [...svg.querySelectorAll("text")];
    expect(texts).toHaveLength(2);
    expect(texts.every((t) => t.namespaceURI === SVG_NS)).toBe(true);

    // Mutate — index-based path disposes old entry and recreates.
    items.set(["x", "y", "z"]);
    await flush();

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
    await flush();

    expect(svg.querySelector("[data-kind=circle]")?.namespaceURI).toBe(SVG_NS);
    expect(svg.querySelector("[data-kind=rect]")).toBeNull();

    flag.set(false);
    await flush();

    expect(svg.querySelector("[data-kind=circle]")).toBeNull();
    const rect = svg.querySelector("[data-kind=rect]");
    expect(rect).not.toBeNull();
    expect(rect!.namespaceURI).toBe(SVG_NS);

    flag.set(true);
    await flush();

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
    await flush();

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
    await flush();

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
    await flush();

    const spans = [...div.querySelectorAll("span")];
    expect(spans).toHaveLength(2);
    // HTML XHTML namespace under happy-dom is the HTML namespace.
    expect(spans.every((s) => s.namespaceURI !== SVG_NS)).toBe(true);
  });
});

describe("SVG: adoption keeps one element's props, its ref and its case", () => {
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

describe("SVG: tags get their namespace at creation", () => {
  beforeEach(() => { document.body.innerHTML = ""; });
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

// An <a> (as <script>, <style>, <title>) is created as HTML and adopted as it is placed in an
// <svg>: a fresh element, with its props applied again. Those prop effects belong to the render
// that placed it, so it is adopted inside that render's scope (todo #9).
describe("an adopted SVG <a> keeps its props for as long as its render, and no longer", () => {
  const hrefOf = (svg: Element) => svg.querySelector("a")!.getAttribute("href");

  test("in a when() branch: through a change of truthy value, and gone with the branch", () => {
    pushDisposeScope();
    const cond = signal(0);
    const href = signal("#1");
    const svg = document.createElementNS(SVG_NS, "svg");
    const dispose = mount(svg, () => <g>{when(cond, () => <a href={href}>x</a>)}</g>);
    cond.set(1); // the branch builds in place, inside the <g>: adopted there
    expect(svg.querySelector("a")!.namespaceURI).toBe(SVG_NS);
    cond.set(2); // same branch, new value: when()'s effect runs again
    href.set("#2");
    expect(hrefOf(svg)).toBe("#2"); // before: "#1", the adopted href went with that run
    const a = svg.querySelector("a")!;
    cond.set(0);
    href.set("#3");
    expect(a.getAttribute("href")).toBe("#2"); // went with its branch
    dispose();
    popDisposeScope()();
  });

  test("mount() into an <svg>: gone with the mount", () => {
    const href = signal("#1");
    const svg = document.createElementNS(SVG_NS, "svg");
    const dispose = mount(svg, () => <a href={href}>x</a>);
    const a = svg.querySelector("a")!;
    expect(a.namespaceURI).toBe(SVG_NS);
    href.set("#2");
    expect(a.getAttribute("href")).toBe("#2");
    dispose();
    href.set("#3");
    expect(a.getAttribute("href")).toBe("#2"); // before: "#3", it outlived the mount
  });

  test("an async component's thunk: gone with the component", async () => {
    const href = signal("#1");
    async function Link() {
      await Promise.resolve();
      return () => <a href={href}>x</a>;
    }
    const svg = document.createElementNS(SVG_NS, "svg");
    const dispose = mount(svg, () => <g><Link /></g>);
    await flush();
    await flush();
    const a = svg.querySelector("a")!;
    expect(a.namespaceURI).toBe(SVG_NS);
    href.set("#2");
    expect(a.getAttribute("href")).toBe("#2");
    dispose();
    href.set("#3");
    expect(a.getAttribute("href")).toBe("#2"); // before: "#3", it outlived the component
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

describe("props: style, class and innerHTML values", () => {
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
});

describe("props: a non-function on* warns and attaches nothing", () => {
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

describe("children: what a reactive child renders", () => {
  // when()/list() warn outside a dispose scope — bracket each test in one.
  beforeEach(() => { document.body.innerHTML = ""; pushDisposeScope(); });
  afterEach(() => { popDisposeScope()(); });
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
});

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

describe("types: each tag's props come from the DOM's element types", () => {
  // IntrinsicElements was `[tag: string]: any`, so a typo, React's onClick, or a handler that was
  // a string all compiled. Checked by `bun run check` (tsc over this file): each @ts-expect-error
  // must find its error, and everything else must compile.
  test("a typo, React casing and a non-function handler don't compile", () => {
    const els = [
      // @ts-expect-error -- React's casing: railroad's handlers are the DOM's, lowercase
      <button onClick={() => {}} />,
      // @ts-expect-error -- React's casing, on a multi-word event
      <input onKeyDown={() => {}} />,
      // @ts-expect-error -- a typo
      <div clas="x" />,
      // @ts-expect-error -- a typo, on an element with its own attributes
      <input valeu="x" />,
      // @ts-expect-error -- a handler must be a function
      <button onclick="alert(1)" />,
      // @ts-expect-error -- an attribute value can't be an object
      <div title={{ text: "x" }} />,
      // @ts-expect-error -- a tag that isn't one
      <dvi />,
      // @ts-expect-error -- a <select>'s input event is a plain Event
      <select oninput={(e: InputEvent) => e.data} />,
    ];
    expect(els.every((el) => el instanceof Node)).toBe(true);
  });

  test("the element types its ref, its events and its attributes", () => {
    const n = signal(1);
    const on = signal(false);
    const maybe: (() => void) | undefined = undefined;
    let typed = "";
    const els = [
      <input
        ref={(el) => {
          el.valueAsNumber;
          // @ts-expect-error -- an <input> has no href
          el.href;
        }}
        oninput={(e) => { typed = e.currentTarget.value; }}
        onkeydown={(e) => e.key}
        type="number" value={n} disabled={on} readonly placeholder={n.map(String)}
        tabindex={0} aria-label="count" data-id={n} list="options" form="f"
      />,
      // @ts-expect-error -- a click is a PointerEvent, not a KeyboardEvent
      <button onclick={(e: KeyboardEvent) => e.key} />,
      <button onclick={maybe} ondblclick={null} onmousedown={(e: Event) => e.preventDefault()}>go</button>,
      <label for="x" class={() => (on.get() ? "on" : null)}>x</label>,
      <label htmlFor="x" className="c" />,
      <div style={{ color: "red", "--accent": "blue", opacity: 0.5 }} innerHTML="<b>x</b>" hidden />,
      <div style={() => (on.get() ? "color: red" : null)} role="list" id="d" title={n} />,
      <td colspan={2} rowspan="1" />,
      <iframe srcdoc="<p>" sandbox="allow-scripts" />,
      <form onsubmit={(e) => e.preventDefault()} accept-charset="utf-8" novalidate />,
      <meta http-equiv="refresh" content="5" />,
      <button popovertarget="menu" popovertargetaction="toggle" />,
      <div itemscope itemprop="review" hx-get="/more" x-data="{}" />,
      <select value={n}><option value="1" selected>one</option></select>,
      // SVG takes any attribute (its element types don't name them), with typed refs and events
      <svg viewBox="0 0 10 10" ref={(el) => el.viewBox}>
        <circle cx={5} cy="5" r={n} stroke-width={2} fill="url(#g)" onclick={(e) => e.clientX} />
        <foreignObject width="10" height="10"><div /></foreignObject>
      </svg>,
      // a custom element takes any attribute
      <my-widget some-prop="x" count={n} onclick={() => {}} />,
      // optional in the DOM types (ontouchstart?:), and still handlers
      <div
        ontouchstart={(e) => e.touches.length} ontouchmove={(e: TouchEvent) => e}
        ontouchend={() => {}} ontouchcancel={null}
      />,
      // in the element's event map, with no on* property: focusin/out, composition*
      <div onfocusin={(e) => e.relatedTarget} onfocusout={(e: FocusEvent) => e} oncompositionend={(e) => e.data} />,
      <circle ontouchstart={(e) => e.touches} onfocusin={() => {}} />,
      // input: the DOM types it Event; a text control sends an InputEvent (a <select> doesn't)
      <input oninput={(e: InputEvent) => e.data} />,
      <textarea oninput={(e) => e.inputType + e.currentTarget.value} />,
      <select oninput={(e) => e.currentTarget.value} />,
    ];
    expect(els.every((el) => el instanceof Node)).toBe(true);
    expect(typed).toBe("");
  });
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

describe("component error handling", () => {
  test("a throwing component leaves the dispose stack balanced", () => {
    const Bad = () => { throw new Error("boom"); };

    // Wrap in our own scope so we can prove the count is unchanged afterwards.
    pushDisposeScope();
    expect(() => (createElement as any)(Bad, null)).toThrow("boom");

    // If createElement leaked Bad's scope, this pop would return that scope and
    // a second pop would be needed to drain the stack. Exactly one pop here must
    // balance us, and a further pop must throw (no extra scope was left behind).
    expect(() => popDisposeScope()).not.toThrow();
    expect(() => popDisposeScope()).toThrow(/imbalance/);
  });
});

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
      // the error, which names the fix, is logged after the component's name
      errorSpy.mock.calls.some((c) => c.some((arg) => String(arg).includes("resolve to a thunk"))),
    ).toBe(true);
    errorSpy.mockRestore();
    dispose();
  });

  test("a thunk that returns no Node is reported and renders nothing", async () => {
    const errorSpy = spyOn(console, "error").mockImplementation(() => {});
    async function Wrong() {
      await Promise.resolve();
      return () => "text" as any; // a thunk, but of a string
    }
    const root = document.createElement("div");
    document.body.append(root);
    const dispose = mount(root, () => <Wrong fallback={() => <p>…</p>} />);
    await tick();
    expect(root.textContent).toBe("");
    expect(errorSpy.mock.calls.some((c) => c.some((arg) => String(arg).includes("returned a non-Node")))).toBe(true);
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

  // The fallback renders under a scope of its own, and one that threw kept what it made; the
  // throw left the component before its teardown was registered, so nothing ever disposed it.
  // Now what it made is disposed at the throw, which goes on as before.
  test("a fallback that throws has what it made disposed, and the throw goes on", () => {
    const probe = signal(0);
    let partial = 0;
    async function Slow() {
      await new Promise(() => {});
      return () => <p>never</p>;
    }
    const fallback = () => {
      effect(() => { probe.get(); partial++; });
      throw new Error("fallback failed");
    };
    pushDisposeScope();
    expect(() => <Slow fallback={fallback} />).toThrow("fallback failed");
    popDisposeScope()();
    partial = 0;
    probe.set(1);
    expect(partial).toBe(0);
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

describe("render bodies are untracked: a .get() there subscribes nothing around it", () => {
  // A .get() in a component body, a when() branch, a list() row or a route handler ran with the
  // surrounding effect as the listener, so an unrelated write re-ran that effect: every
  // index-based row rebuilt, a router re-notified params$, a user effect re-rendered.
  // These reads are one-shot on purpose, so their development warning is silenced here.
  let warn: ReturnType<typeof spyOn>;
  beforeEach(async () => {
    warn = spyOn(console, "warn").mockImplementation(() => {});
    location.hash = "#/users/1";
    await tick();
  });
  afterEach(() => { warn.mockRestore(); location.hash = ""; });
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

  test("mount()'s render doesn't subscribe the effect that mounts it", () => {
    // A behaviour change: it did before, so an effect that mounted re-mounted on these reads.
    const x = signal(1);
    const root = document.createElement("div");
    let runs = 0;
    const dispose = effect(() => { runs++; return mount(root, () => <p>{x.get()}</p>); });
    x.set(2);
    expect(runs).toBe(1);
    expect(root.textContent).toBe("1");
    dispose();
  });
});

describe("a .get() in a render body warns once per render body, in development", () => {
  // Components, when() branches, list() rows and route handlers run untracked, so a .get() there
  // is a snapshot that never updates, and nothing said so: the skill's §1, §7 and §9 traps.
  const oneShot = (warn: { mock: { calls: unknown[][] } }) =>
    warn.mock.calls.filter((c) => String(c[0]).includes("reads once")).map((c) => String(c[0]));
  test("in a component, a when() branch, a list() row and a route handler, naming which", async () => {
    const warn = spyOn(console, "warn").mockImplementation(() => {});
    location.hash = "#/";
    await tick();
    const target = document.createElement("div");
    let disposeRoutes = () => {};
    try {
      const [a, b, c, d] = [signal(1), signal(2), signal(3), signal(4)];
      function View() { return <p>{a.get()}{b.get()}</p>; } // two reads in one body: one warning
      const dispose = mount(document.createElement("div"), () => (
        <div>
          <View />
          {when(signal(true), () => <i>{b.get()}</i>)}
          {list(signal([1]), (n) => <b>{n + c.get()}</b>)}
        </div>
      ));
      disposeRoutes = routes(target, { "/": () => <p>{d.get()}</p> });
      const said = oneShot(warn);
      expect(said.length).toBe(4);
      expect(said[0]).toContain(".get() in a render body (<View>)");
      expect(said[0]).toContain(".peek()");
      expect(said.slice(1).map((m) => m.match(/render body \((.*?)\) reads once/)?.[1])).toEqual([
        "a when() branch", "a list() row", "a route handler",
      ]);
      dispose();
    } finally {
      disposeRoutes();
      warn.mockRestore();
      location.hash = "";
    }
  });

  test("a list() of 500 rows, or a component rendered many times, warns once", () => {
    // Once per signal flooded: every row has its own row$, so 500 rows gave 500 warnings.
    const warn = spyOn(console, "warn").mockImplementation(() => {});
    try {
      const rows = signal(Array.from({ length: 500 }, (_, i) => ({ id: i, text: `row ${i}` })));
      const n = signal(1);
      function Row() { return <b>{n.get()}</b>; }
      const dispose = mount(document.createElement("div"), () => (
        <div>
          <ul>{list(rows, (r) => r.id, (r$) => <li>{r$.get().text}</li>)}</ul>
          <Row /><Row /><Row />
        </div>
      ));
      expect(oneShot(warn).map((m) => m.match(/render body \((.*?)\) reads once/)?.[1])).toEqual(["a list() row", "<Row>"]);
      dispose();
    } finally {
      warn.mockRestore();
    }
  });

  test("a bound read, .peek(), untrack(), an effect, a handler and railroad's own reads don't", () => {
    const warn = spyOn(console, "warn").mockImplementation(() => {});
    try {
      const x = signal(1);
      const show = signal(true);
      const rows = signal([{ id: 1 }]);
      function View() {
        effect(() => { x.get(); });
        const once = x.peek() + untrack(() => x.get());
        return (
          <button onclick={() => x.set(x.get() + 1)} class={() => String(x.get())}>
            {x}{x.map((n) => n + once)}{() => x.get()}
          </button>
        );
      }
      const root = document.createElement("div");
      const dispose = mount(root, () => (
        <div>
          {when(show, () => <View />)}
          {when(() => x.get() > 0, () => <i />)}
          {list(rows, (r) => r.id, (r$) => <b>{r$.map((r) => r.id)}</b>)}
          {list(rows, (r) => <b>{r.id}</b>)}
        </div>
      ));
      (root.querySelector("button") as HTMLButtonElement).click();
      x.set(5);
      rows.set([{ id: 2 }]);
      expect(oneShot(warn)).toEqual([]);
      dispose();
    } finally {
      warn.mockRestore();
    }
  });

  test("a production build leaves it out", () => {
    const cwd = new URL(".", import.meta.url).pathname;
    const script = `
      const { createElement, mount } = await import("./jsx.ts");
      const { signal } = await import("./signals.ts");
      const s = signal(1);
      mount(document.body, () => createElement(function View() { return createElement("p", null, s.get()); }, null));`;
    const run = (NODE_ENV: string) => Bun.spawnSync(
      [process.execPath, "--preload", "./happy-dom.setup.ts", "-e", script],
      { cwd, env: { ...process.env, NODE_ENV } },
    ).stderr.toString();
    expect(run("development")).toContain("reads once");
    expect(run("production")).not.toContain("reads once");
  });
});

describe("a Signal from another copy of railroad throws where it is rendered", () => {
  // Two copies can't share tracking, so the other copy's signal rendered as "[object Object]" and
  // a when() on it never switched: the load-time error was the only sign. Now the render says so.
  test("a real second copy's signal, rendered by this copy's JSX", () => {
    // A query string makes Bun evaluate signals.ts again as a module of its own, with its own
    // Signal class, as a linked checkout's node_modules/@blueshed/railroad is. In a child process,
    // so the copy stays out of this one's coverage (Bun would report it as signals.ts).
    const cwd = new URL(".", import.meta.url).pathname;
    const run = Bun.spawnSync([process.execPath, "--preload", "./happy-dom.setup.ts", "-e", `
      const { createElement, when, mount } = await import("./jsx.ts");
      const copy = await import("./signals.ts?copy");
      const data = copy.signal({ title: "board" });
      for (const render of [() => createElement("p", null, data), () => when(data, () => createElement("p", null))]) {
        try { mount(document.body, render); console.log("rendered"); } catch (e) { console.log(e.message); }
      }`], { cwd });
    const out = run.stdout.toString();
    expect(out).not.toContain("rendered");
    expect(out.match(/made by another copy of @blueshed\/railroad/g)?.length).toBe(2);
    expect(out).toContain(new URL("./signals.ts?copy", import.meta.url).href); // the copy that made it
    expect(out).toContain(`this copy (${new URL("./signals.ts", import.meta.url).href})`);
  });
  // What another copy's Signal looks like to this one: a class of its own, whose prototype carries
  // the URL of the copy that made it under the key every copy shares.
  const elsewhere = "file:///app/node_modules/@blueshed/delta/node_modules/@blueshed/railroad/signals.ts";
  class OtherCopySignal<T> {
    constructor(private value: T) {}
    get() { return this.value; }
    peek() { return this.value; }
    map<U>(fn: (v: T) => U): ReadonlySignal<U> { return new OtherCopySignal(fn(this.value)); }
  }
  (OtherCopySignal.prototype as any)[Symbol.for("@blueshed/railroad.Signal")] = elsewhere;

  test("as a child, a prop, a when() condition or a list() source, naming both copies", () => {
    const data = new OtherCopySignal({ title: "board" });
    const rows = new OtherCopySignal(["a"]);
    const root = document.createElement("div");
    const tries: Array<() => unknown> = [
      () => <p>{data}</p>,
      () => <p title={data as unknown as string} />,
      () => mount(root, () => when(data, () => <p>loaded</p>)),
      () => mount(root, () => list(rows, (s) => <li>{s}</li>)),
    ];
    for (const t of tries) {
      expect(t).toThrow("made by another copy of @blueshed/railroad");
      expect(t).toThrow(elsewhere);
      expect(t).toThrow(`this copy (${new URL("./signals.ts", import.meta.url).href})`);
    }
    expect(root.childNodes.length).toBe(0);
    expect(hasActiveDisposeScope()).toBe(false);
  });

  test("plain objects, and this copy's signals, pass", () => {
    const s = signal("x");
    const el = <p style={{ color: "red" }} title={s}>{s}</p> as HTMLElement;
    expect(el.textContent).toBe("x");
    expect(el.title).toBe("x");
  });
});

describe("when() and list() composition", () => {
  scoped();

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
    await flush();

    const li1 = root.querySelector('[data-id="1"]')!;
    expect(li1.querySelector(".body")).toBeNull();

    items.set([
      { id: 1, open: true },
      { id: 2, open: false },
    ]);
    await flush();
    expect(li1.querySelector(".body")?.textContent).toBe("open");

    items.set([
      { id: 1, open: false },
      { id: 2, open: false },
    ]);
    await flush();
    expect(li1.querySelector(".body")).toBeNull();
  });
});

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

describe("when(): the active branch goes with the scope around it", () => {
  // when()/list() warn outside a dispose scope — bracket each test in one.
  beforeEach(() => { document.body.innerHTML = ""; pushDisposeScope(); });
  afterEach(() => { popDisposeScope()(); });
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
});

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

  // A branch that threw was kept as the live branch (0.15), so what it made before the throw
  // stayed subscribed: for good on the first render, where the throw leaves when() before its
  // teardown is registered, and until the next swap on an update; and a later truthy value never
  // built it again. Now what it made is disposed at the throw, and the next change builds again.
  test("on the first render or an update, what it made is disposed, and the next change builds again", () => {
    const probe = signal(0);
    let partial = 0;
    let failing = true;
    const branch = () => {
      effect(() => { probe.get(); partial++; });
      if (failing) throw new Error("branch failed");
      return <p>ok</p>;
    };

    // The first render: the throw leaves when(), and nothing it made outlives the scope around it.
    pushDisposeScope();
    expect(() => when(signal(true), branch)).toThrow("branch failed");
    popDisposeScope()();
    partial = 0;
    probe.set(1);
    expect(partial).toBe(0);

    // An update: the throw reaches the writer, and nothing of the branch stays.
    const cond = signal(0);
    const root = document.createElement("div");
    const dispose = mount(root, () => when(cond, branch, () => <i>none</i>));
    expect(root.textContent).toBe("none");
    expect(() => cond.set(1)).toThrow("branch failed");
    expect(root.textContent).toBe("");
    partial = 0;
    probe.set(2);
    expect(partial).toBe(0);

    failing = false;
    cond.set(2); // still truthy, and the branch is built again
    expect(root.textContent).toBe("ok");
    dispose();
    expect(root.textContent).toBe("");
  });

  // The throw leaves when() after its effect is made, and its teardown was registered after that.
  // If the scope around it lives on (a caller catches the throw, or an effect's run threw and the
  // effect runs again later), the when() lives on too; and since the next change builds again, it
  // built a branch that nothing would dispose. The teardown now comes first, as list()'s does.
  test("a when() whose first render threw builds nothing that outlives the scope around it", () => {
    const probe = signal(0);
    const cond = signal(1);
    let runs = 0;
    let failing = true;
    pushDisposeScope();
    expect(() =>
      when(cond, () => {
        if (failing) throw new Error("first");
        effect(() => { probe.get(); runs++; });
        return <p>ok</p>;
      }),
    ).toThrow("first");
    failing = false;
    cond.set(2); // the when() is still live, and builds its branch
    expect(runs).toBe(1);
    popDisposeScope()();
    probe.set(1);
    expect(runs).toBe(1); // the branch went with the scope
  });
});

describe("when(cond, (v$) => …): the branch reads the current truthy value", () => {
  // when() rebuilds only when truthiness flips, so a branch that read the value once kept the first
  // one: /sites/42 → /sites/99 showed 42. The branch now gets the value as a signal.
  test("a value change inside the truthy branch reaches v$ without a rebuild", () => {
    const detail = signal<{ id: string } | null>({ id: "42" });
    let builds = 0;
    const root = document.createElement("div");
    const dispose = mount(root, () => (
      <div>
        {when(detail, (d$) => {
          builds++;
          // No `!`: v$ is narrowed to the truthy value.
          return <p>{d$.map((d) => d.id)}</p>;
        }, () => <i>none</i>)}
      </div>
    ));
    const p = root.querySelector("p");
    expect(root.textContent).toBe("42");
    detail.set({ id: "99" });
    expect(root.textContent).toBe("99");
    expect(root.querySelector("p")).toBe(p); // same branch, not rebuilt
    detail.set(null);
    expect(root.textContent).toBe("none");
    detail.set({ id: "7" });
    expect(root.textContent).toBe("7");
    expect(builds).toBe(2);
    dispose();
  });

  test("v$ follows an in-place touch(), as the condition does", () => {
    const doc = signal<{ title: string } | null>({ title: "a" });
    const root = document.createElement("div");
    const dispose = mount(root, () => <div>{when(doc, (d$) => <p>{d$.map((d) => d.title, { equals: () => false })}</p>)}</div>);
    doc.peek()!.title = "b";
    doc.touch();
    expect(root.textContent).toBe("b");
    dispose();
  });

  test("a function condition passes its value, narrowed", () => {
    const n = signal(1);
    const root = document.createElement("div");
    const dispose = mount(root, () => <div>{when(() => n.get() > 0 && `n=${n.get()}`, (v$) => <p>{v$}</p>)}</div>);
    expect(root.textContent).toBe("n=1");
    n.set(2);
    expect(root.textContent).toBe("n=2");
    n.set(0);
    expect(root.textContent).toBe("");
    dispose();
  });
});

describe("list(): duplicate keys warn", () => {
  // when()/list() warn outside a dispose scope — bracket each test in one.
  beforeEach(() => { document.body.innerHTML = ""; pushDisposeScope(); });
  afterEach(() => { popDisposeScope()(); });
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
});

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

describe("list(): a row that throws", () => {
  // A row renders under a scope of its own, and 0.15 pushed it with no try/finally: a row that
  // threw left it pushed, so the effect running the list popped the row's scope in place of its
  // own, and every later scope was off by one (todo n8). Now the row's scope closes on every path,
  // what the row made before the throw is disposed, nothing of it is inserted, the other rows
  // render, and the throw goes on to the writer, as a when() branch's does.
  beforeEach(() => { document.body.innerHTML = ""; });
  // Runs `act` in a scope of our own, then makes an effect and closes the scope. Had the throw
  // left a scope open, the pop would close that one instead, and ours would never be disposed.
  const expectBalancedAround = (act: () => void) => {
    pushDisposeScope();
    let ours = false;
    trackDispose(() => { ours = true; });
    act();
    const after = signal(0);
    let afterRuns = 0;
    effect(() => { after.get(); afterRuns++; });
    popDisposeScope()();
    expect(ours).toBe(true);
    after.set(1);
    expect(afterRuns).toBe(1); // the effect made after the throw went with our scope
  };
  const texts = (root: Element) => [...root.querySelectorAll("li")].map((li) => li.textContent);
  test("a new keyed row that throws is left out, and the list goes on updating", () => {
    const probe = signal(0);
    let partial = 0; // runs of the effect the throwing row made before it threw
    let siblings = 0; // runs of the other rows' effects
    let failing = 3;
    const Row = (r$: ReadonlySignal<{ id: number }>) => {
      const { id } = r$.peek();
      if (id === failing) {
        effect(() => { probe.get(); partial++; });
        throw new Error(`row ${id}`);
      }
      effect(() => { probe.get(); siblings++; });
      return <li>{String(id)}</li>;
    };
    const rows = (...ids: number[]) => ids.map((id) => ({ id }));

    // On the first render the throw leaves list() and mount(), and the rows made beside it go
    // with mount()'s scope rather than stay subscribed.
    expectBalancedAround(() =>
      expect(() => mount(document.createElement("div"), () => <ul>{list(signal(rows(1, 3, 4)), (r) => r.id, Row)}</ul>)).toThrow("row 3"),
    );
    partial = 0;
    siblings = 0;
    probe.set(1);
    expect(partial).toBe(0);
    expect(siblings).toBe(0);

    // On an update the throw reaches the writer, and the rows either side of it render (the
    // sync runs right to left, so row 0 comes after the throw).
    const items = signal(rows(1, 2));
    const root = document.createElement("div");
    const dispose = mount(root, () => <ul>{list(items, (r) => r.id, Row)}</ul>);
    expectBalancedAround(() => expect(() => items.set(rows(0, 1, 2, 3, 4))).toThrow("row 3"));
    expect(texts(root)).toEqual(["0", "1", "2", "4"]);
    partial = 0;
    probe.set(2);
    expect(partial).toBe(0); // what row 3 made before it threw was disposed

    failing = -1;
    items.set(rows(0, 1, 2, 3, 4, 5)); // row 3 is new again, and lands in its place
    expect(texts(root)).toEqual(["0", "1", "2", "3", "4", "5"]);
    items.set(rows(5, 1));
    expect(texts(root)).toEqual(["5", "1"]);
    dispose();
    expect(root.querySelectorAll("li")).toHaveLength(0);
  });

  test("a new unkeyed row that throws is left out, and the list goes on updating", () => {
    const probe = signal(0);
    let partial = 0;
    let failing = "x";
    const items = signal(["a", "b"]);
    const root = document.createElement("div");
    const dispose = mount(root, () => (
      <ul>
        {list(items, (item) => {
          if (item === failing) {
            effect(() => { probe.get(); partial++; });
            throw new Error(`row ${item}`);
          }
          return <li>{item}</li>;
        })}
      </ul>
    ));
    expectBalancedAround(() => expect(() => items.set(["A", "b", "x", "d"])).toThrow("row x"));
    expect(texts(root)).toEqual(["A", "b", "d"]); // index 0 rebuilds after the throw
    partial = 0;
    probe.set(1);
    expect(partial).toBe(0);

    failing = "";
    items.set(["a", "b", "x", "d", "e"]); // index 2 is new again, and lands in its place
    expect(texts(root)).toEqual(["a", "b", "x", "d", "e"]);
    items.set(["z"]);
    expect(texts(root)).toEqual(["z"]);
    dispose();
    expect(root.querySelectorAll("li")).toHaveLength(0);
  });

  test("a row placed in <svg> is adopted under its own scope, and a throw there leaves it out", () => {
    const probe = signal(0);
    const applies = new Map<number, number>();
    const items = signal<number[]>([]);
    const svg = document.createElementNS(SVG_NS, "svg");
    const dispose = mount(svg, () => (
      <g>
        {list(items, (i) => i, (i$) => {
          // An <a> is created as HTML, and adopted as the row is placed in the <g>, which
          // applies its href again: the second call, which throws for row 2. Keyed, so rows 1
          // and 3 are kept, not rebuilt, when the list runs again.
          const i = i$.peek();
          let calls = 0;
          const href = () => {
            probe.get();
            applies.set(i, (applies.get(i) ?? 0) + 1);
            if (i === 2 && ++calls > 1) throw new Error("adoption failed");
            return `#${i}`;
          };
          return <a href={href}>{String(i)}</a>;
        })}
      </g>
    ));
    const anchors = () => [...svg.querySelectorAll("a")].map((a) => `${a.namespaceURI === SVG_NS ? "svg" : "html"} ${a.getAttribute("href")}`);

    expectBalancedAround(() => expect(() => items.set([1, 2, 3])).toThrow("adoption failed"));
    expect(anchors()).toEqual(["svg #1", "svg #3"]);
    items.set([1, 3, 4]); // the list runs again, and disposes what its last run owned
    applies.clear();
    probe.set(1);
    // Each adopted href is its row's own, so it outlives the list's run; row 2's went with it.
    expect([...applies.keys()].sort()).toEqual([1, 3, 4]);
    dispose();
    applies.clear();
    probe.set(2);
    expect(applies.size).toBe(0);
  });

  test("an index-based rebuild that throws leaves its row empty, rebuilt on the next change", () => {
    const probe = signal(0);
    let partial = 0;
    let failing = "";
    const cleanups: string[] = [];
    const items = signal(["a", "b", "c"]);
    const root = document.createElement("div");
    const dispose = mount(root, () => (
      <ul>
        {list(items, (item) => {
          trackDispose(() => cleanups.push(item));
          if (item === failing) {
            effect(() => { probe.get(); partial++; });
            throw new Error(`row ${item}`);
          }
          return <li>{item}</li>;
        })}
      </ul>
    ));
    failing = "B";
    expectBalancedAround(() => expect(() => items.set(["a", "B", "c"])).toThrow("row B"));
    expect(texts(root)).toEqual(["a", "c"]); // every other row rebuilt; B's is empty
    expect(cleanups.sort()).toEqual(["B", "a", "b", "c"]); // the old rows, and what B made
    partial = 0;
    probe.set(1);
    expect(partial).toBe(0);

    failing = "";
    cleanups.length = 0;
    items.set(["a", "B", "c", "d"]);
    expect(texts(root)).toEqual(["a", "B", "c", "d"]);
    expect(cleanups.sort()).toEqual(["a", "c"]); // b's cleanup ran once, not again here
    dispose();
    expect(root.querySelectorAll("li")).toHaveLength(0);
  });
});

// A row whose render disposes the scope that owns the list (a navigation, say) runs the list's
// teardown mid-sync: the sync must stop there, and the row it just built must go too (todo #10).
describe("list(): a row that disposes the list's owner mid-sync", () => {
  test("the sync stops without a throw, and nothing it built outlives the owner", () => {
    const items = signal([1]);
    const probe = signal(0);
    let runs = 0;
    let disposeOwner = () => {};
    const root = document.createElement("div");
    pushDisposeScope();
    root.append(
      <ul>
        {list(items, (i) => i, (i$) => {
          const i = i$.peek();
          effect(() => { probe.get(); runs++; });
          if (i === 2) disposeOwner();
          return <li>{i}</li>;
        })}
      </ul>,
    );
    disposeOwner = popDisposeScope();
    // Rows render from the end: 3 is placed, then 2 disposes the owner, row 3 and row 1 with it.
    expect(() => items.set([1, 2, 3])).not.toThrow(); // before: insertBefore a removed row
    runs = 0;
    probe.set(1);
    expect(runs).toBe(0); // before: row 2's effect, built after the teardown, ran on
    expect(root.querySelectorAll("li")).toHaveLength(0);
  });
});

// The same for a when() branch and an async component's thunk: a render that disposes the scope
// owning it (a navigation, say) ran after the teardown, so it was inserted and stayed live.
describe("when() and async components: a render that disposes its owner", () => {
  test("a when() branch is not inserted, and nothing it made outlives the owner", () => {
    const cond = signal(0);
    const probe = signal(0);
    let runs = 0;
    let disposeOwner = () => {};
    const root = document.createElement("div");
    pushDisposeScope();
    root.append(
      <div>
        {when(cond, (v$) => {
          effect(() => { probe.get(); runs++; });
          if (v$.peek() === 2) disposeOwner();
          return <p>{v$.peek()}</p>;
        })}
      </div>,
    );
    disposeOwner = popDisposeScope();
    cond.set(2);
    runs = 0;
    probe.set(1);
    expect(runs).toBe(0); // before: 1, the branch's effect ran on
    expect(root.querySelector("p")).toBeNull(); // before: inserted after the teardown
  });

  test("an async component's thunk is not inserted, and nothing it made outlives the owner", async () => {
    const probe = signal(0);
    let runs = 0;
    let disposeOwner = () => {};
    async function A() {
      await Promise.resolve();
      return () => {
        effect(() => { probe.get(); runs++; });
        disposeOwner();
        return <p>a</p>;
      };
    }
    const root = document.createElement("div");
    pushDisposeScope();
    root.append(<div><A /></div>);
    disposeOwner = popDisposeScope();
    await flush();
    await flush();
    runs = 0;
    probe.set(1);
    expect(runs).toBe(0);
    expect(root.querySelector("p")).toBeNull();
  });
});

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

describe("mount() and the scope-less warning", () => {
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
});
