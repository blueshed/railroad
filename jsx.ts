/**
 * JSX Runtime — real DOM elements backed by signals
 *
 * createElement(tag, props, ...children)
 *   - tag: string → creates HTML element (or SVG element inside <svg>)
 *   - tag: function → calls component function(props)
 *   - props: attributes, event handlers (onclick etc), ref
 *   - children: string, number, Node, Signal<T>, () => any, arrays, null/undefined
 *
 * When a Signal is used as a child, an effect auto-updates the text node.
 * When a function is used as a child, it auto-tracks dependencies:
 *   <span>{() => count.get() > 5 ? "High" : "Low"}</span>
 * When a Signal is used as a prop value, an effect auto-updates the attribute.
 *
 * Components are auto-scoped — effects/computeds inside are disposed when
 * the parent scope (route, when, list) tears down. No manual dispose needed.
 *
 * SVG support:
 *   SVG-only tags (circle, g, linearGradient, foreignObject, fe* filters, …)
 *   are created directly in the SVG namespace — refs fire once, manual
 *   addEventListener calls survive, camelCase is preserved, and
 *   <foreignObject> children stay HTML. The only tags that can't be decided
 *   at creation are the four shared with HTML (a, script, style, title):
 *   those are created as HTML and namespace-adopted when appended to an SVG
 *   parent. On that fallback path the adopted element is a fresh node, so a
 *   `ref` fires twice (use the last call) and manual addEventListener calls
 *   are lost — use on* props, which are re-applied. Elements built by hand
 *   with createElementNS pass through untouched.
 *
 * Reactive helpers:
 *   mount(target, render)         — root dispose scope; returns the disposer
 *   when(signal, truthy, falsy?)  — conditional rendering, swaps DOM nodes
 *   list(signal, keyFn, render)   — keyed reactive list, render receives Signal<T>
 *   list(signal, render)          — index-based reactive list, render receives raw T
 *
 * when() and list() warn if created outside a dispose scope (a component,
 * routes() handler, when/list render, or mount()) — their internal effects
 * would be impossible to tear down.
 */

import { Signal, signal, effect, computed, pushDisposeScope, popDisposeScope, trackDispose, hasActiveDisposeScope } from "./signals";
import type { Dispose, ReadonlySignal } from "./signals";

// pushDisposeScope / popDisposeScope are internal — used by createElement, when, list, routes

// === SVG namespace ===

const SVG_NS = "http://www.w3.org/2000/svg";

// SVG-only tag names (no overlap with HTML), so the namespace is decided at
// creation: refs fire once, manual addEventListener survives, and no adoption
// pass is needed for real SVG work. The four tags shared with HTML (a, script,
// style, title) can't be disambiguated bottom-up — they are created as HTML
// and namespace-adopted on append to an SVG parent, the legacy path.
const SVG_TAGS = new Set([
  "animate", "animateMotion", "animateTransform", "circle", "clipPath",
  "defs", "desc", "ellipse", "feBlend", "feColorMatrix", "feComponentTransfer",
  "feComposite", "feConvolveMatrix", "feDiffuseLighting", "feDisplacementMap",
  "feDistantLight", "feDropShadow", "feFlood", "feFuncA", "feFuncB", "feFuncG",
  "feFuncR", "feGaussianBlur", "feImage", "feMerge", "feMergeNode",
  "feMorphology", "feOffset", "fePointLight", "feSpecularLighting",
  "feSpotLight", "feTile", "feTurbulence", "filter", "foreignObject", "g",
  "image", "line", "linearGradient", "marker", "mask", "metadata", "mpath",
  "path", "pattern", "polygon", "polyline", "radialGradient", "rect", "set",
  "stop", "svg", "switch", "symbol", "text", "textPath", "tspan", "use",
  "view",
]);

const storedProps = new WeakMap<Element, Record<string, any>>();
// document.createElement() lowercases tag names in HTML documents. Known SVG
// tags never hit that path (created via createElementNS above), but remember
// the authored tag for anything else so the adoption fallback can recreate a
// future/unknown camelCase element with its original case.
const authoredTags = new WeakMap<Element, string>();
// Disposers for the reactive effects applyProps creates per element. SVG
// adoption discards the original HTML-namespace element and re-applies its
// props to a fresh SVG element; without tearing these down first, both elements
// would stay subscribed and the detached one would keep being written to.
const propEffectDisposers = new WeakMap<Element, Dispose[]>();

// === Fragment ===

export function Fragment(props: any): DocumentFragment {
  const frag = document.createDocumentFragment();
  const children = props?.children
    ? (Array.isArray(props.children) ? props.children : [props.children])
    : [];
  appendChildren(frag, children);
  return frag;
}

// === Props application ===

function applyProps(el: Element, props: Record<string, any>): void {
  const disposers: Dispose[] = [];
  for (const [key, value] of Object.entries(props)) {
    if (key === "ref") {
      if (typeof value === "function") value(el);
    } else if (key === "innerHTML") {
      if (value instanceof Signal) {
        disposers.push(effect(() => { el.innerHTML = value.get(); }));
      } else {
        el.innerHTML = value;
      }
    } else if (key === "className" || key === "class") {
      if (value instanceof Signal) {
        disposers.push(effect(() => { el.setAttribute("class", value.get()); }));
      } else {
        el.setAttribute("class", value);
      }
    } else if (key === "value" || key === "checked" || key === "disabled" || key === "selected" || key === "srcdoc" || key === "src") {
      // Coerce null/undefined to "" so a cleared signal doesn't write the
      // literal string "null"/"undefined" into the DOM property.
      if (value instanceof Signal) {
        disposers.push(effect(() => { (el as any)[key] = value.get() ?? ""; }));
      } else {
        (el as any)[key] = value ?? "";
      }
    } else if (key === "style" && value instanceof Signal) {
      const oldKeys = new Set<string>();
      disposers.push(effect(() => {
        const nextStyle = (value.get() || {}) as Record<string, string>;
        const elStyle = (el as HTMLElement).style;
        for (const k of oldKeys) {
          if (!(k in nextStyle)) {
            elStyle[k as any] = "";
          }
        }
        oldKeys.clear();
        for (const [k, v] of Object.entries(nextStyle)) {
          elStyle[k as any] = v;
          oldKeys.add(k);
        }
      }));
    } else if (key === "style" && typeof value === "object") {
      Object.assign((el as HTMLElement).style, value);
    } else if (key.startsWith("on")) {
      el.addEventListener(key.slice(2).toLowerCase(), value);
    } else {
      if (value instanceof Signal) {
        disposers.push(effect(() => {
          const v = value.get();
          if (v === false || v == null) el.removeAttribute(key);
          else el.setAttribute(key, String(v));
        }));
      } else if (value !== false && value != null) {
        el.setAttribute(key, String(value));
      }
    }
  }
  if (disposers.length) propEffectDisposers.set(el, disposers);
}

// === createElement ===

export function createElement(
  tag: string | Function,
  props: Record<string, any> | null,
  ...children: any[]
): Node {
  if (typeof tag === "function") {
    const componentProps = { ...props, children };
    pushDisposeScope();
    // finally (not a trailing pop) so a throwing component still balances the
    // dispose stack — otherwise the leaked scope corrupts every later push/pop.
    try {
      return tag(componentProps);
    } finally {
      trackDispose(popDisposeScope());
    }
  }

  // SVG-only tags are created in the SVG namespace outright; only the
  // HTML/SVG-ambiguous tags fall back to adoption in appendChildren.
  const el = SVG_TAGS.has(tag)
    ? document.createElementNS(SVG_NS, tag)
    : document.createElement(tag);
  if (el.localName !== tag) authoredTags.set(el, tag);

  if (props) {
    storedProps.set(el, props);
    applyProps(el, props);
  }

  appendChildren(el, children);
  return el;
}

// === SVG adoption ===

/**
 * Recursively adopt an HTML element into the SVG namespace.
 * Creates a new SVG element, re-applies stored props (or copies
 * attributes), and recursively adopts all children.
 */
function adoptSvg(node: Node): Node {
  if (node instanceof Text || node instanceof Comment) return node;
  if (!(node instanceof Element) || node.namespaceURI === SVG_NS) return node;

  const svgEl = document.createElementNS(
    SVG_NS,
    authoredTags.get(node) ?? node.localName,
  );
  const props = storedProps.get(node);

  if (props) {
    // Dispose the discarded HTML element's reactive prop effects before
    // re-applying props to the SVG element, so each signal keeps exactly one
    // live effect (targeting svgEl) rather than leaking one onto the detached
    // node. The disposed effects are idempotent, so the owning scope tearing
    // them down again later is a no-op.
    const oldDisposers = propEffectDisposers.get(node);
    if (oldDisposers) {
      for (const d of oldDisposers) d();
      propEffectDisposers.delete(node);
    }
    storedProps.set(svgEl, props);
    applyProps(svgEl, props);
  } else {
    // No stored props — copy attributes directly
    for (let i = 0; i < node.attributes.length; i++) {
      const attr = node.attributes[i]!;
      svgEl.setAttribute(attr.name, attr.value);
    }
  }

  // Adopt children recursively — except through <foreignObject>, whose
  // subtree is HTML content by definition and must keep its namespace.
  const isForeign = svgEl.localName === "foreignObject";
  while (node.firstChild) {
    const child = node.removeChild(node.firstChild);
    svgEl.appendChild(isForeign ? child : adoptSvg(child));
  }

  return svgEl;
}

/**
 * Adopt a render result into the SVG namespace if the target parent is SVG.
 * Must run before the caller captures child-node references, because
 * `adoptSvg` replaces elements with fresh SVG-namespace copies.
 *
 * DocumentFragments are mutated in place; single elements are returned
 * swapped (caller must reassign).
 */
function adoptIntoSvg(result: Node, parent: Node | null): Node {
  // <foreignObject> is an SVG-namespace element whose children are HTML —
  // adoption stops at that boundary.
  if (
    !(parent instanceof Element) ||
    parent.namespaceURI !== SVG_NS ||
    parent.localName === "foreignObject"
  ) {
    return result;
  }
  if (result instanceof DocumentFragment) {
    const children = [...result.childNodes];
    for (const child of children) {
      if (child instanceof Element && child.namespaceURI !== SVG_NS) {
        result.replaceChild(adoptSvg(child), child);
      }
    }
    return result;
  }
  if (result instanceof Element && result.namespaceURI !== SVG_NS) {
    return adoptSvg(result);
  }
  return result;
}

// === Child rendering ===

function appendChildren(parent: Node, children: any[]): void {
  // foreignObject children are HTML by definition — never adopt them.
  const isSvgParent = parent instanceof Element &&
    parent.namespaceURI === SVG_NS &&
    parent.localName !== "foreignObject";

  for (const child of children.flat(Infinity)) {
    if (child == null || child === false || child === true) continue;

    if (child instanceof Signal) {
      const text = document.createTextNode(String(child.peek()));
      effect(() => {
        text.textContent = String(child.get());
      });
      parent.appendChild(text);
    } else if (typeof child === "function") {
      const fn = child as () => any;
      const textNode = document.createTextNode("");
      let warnedNode = false;
      effect(() => {
        const v = fn();
        if (!warnedNode && v instanceof Node) {
          warnedNode = true;
          console.warn(
            "[railroad/jsx] A function child returned a DOM Node; it is rendered " +
              "as text, not inserted as an element. To render elements reactively, " +
              "use when() or list().",
          );
        }
        textNode.textContent = String(v ?? "");
      });
      parent.appendChild(textNode);
    } else if (child instanceof Node) {
      // Adopt HTML elements — and the element children of DocumentFragments
      // (from <>...</> or components returning fragments) — into the SVG
      // namespace when the parent is SVG. adoptIntoSvg handles both shapes
      // and passes Text/Comment/already-SVG nodes through untouched.
      parent.appendChild(isSvgParent ? adoptIntoSvg(child, parent) : child);
    } else {
      parent.appendChild(document.createTextNode(String(child)));
    }
  }
}


// === mount() — root dispose scope for an app mounted outside routes() ===

/**
 * Mount UI into `target` under a fresh dispose scope. Effects, computeds,
 * when() and list() created by `render` tear down when the returned disposer
 * runs, which also removes the rendered nodes. Use this (or routes()) for app
 * roots so the scope rules in signals.ts hold all the way down.
 *
 *   const dispose = mount(document.getElementById("root")!, () => <App />);
 */
export function mount(target: Element, render: () => Node): Dispose {
  pushDisposeScope();
  let result: Node;
  try {
    result = render();
  } catch (err) {
    popDisposeScope()(); // dispose children created before the throw
    throw err;
  }
  const scopeDispose = popDisposeScope();
  const adopted = adoptIntoSvg(result, target);
  const nodes = adopted instanceof DocumentFragment
    ? [...adopted.childNodes]
    : [adopted];
  target.appendChild(adopted);
  let disposed = false;
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    scopeDispose();
    for (const n of nodes) n.parentNode?.removeChild(n);
  };
  trackDispose(dispose); // nested mounts compose with an outer scope
  return dispose;
}

// Scope guardrail: when()/list() return DOM nodes, not disposers, so outside
// a dispose scope their internal effects are unreachable — a guaranteed leak
// once the UI is ever unmounted. Warn with the supported alternatives.
function warnScopeless(helper: string): void {
  console.warn(
    `[railroad/${helper}] created outside a dispose scope — its effects can ` +
      "never be torn down. Render it inside a component, a routes() handler, " +
      "or mount().",
  );
}

// === when() — conditional rendering ===
// Swaps DOM nodes only when truthiness transitions (falsy↔truthy).
// Value changes within the same branch (e.g. "a" → "b") do NOT re-render.
// Components inside each branch should use signals to react to value changes.
//   when(isLoggedIn, () => <Dashboard />, () => <Login />)

export function when(
  condition: ReadonlySignal<any> | (() => any),
  truthy: () => Node,
  falsy?: () => Node,
): Node {
  if (!hasActiveDisposeScope()) warnScopeless("when");
  const anchor = document.createComment("when");
  let currentNodes: Node[] = [];
  let currentDispose: Dispose | null = null;
  let wasTruthy: boolean | undefined = undefined;

  const sig: ReadonlySignal<any> = typeof condition === "function"
    ? computed(condition)
    : condition;

  function swap() {
    const val = sig.get();
    const isTruthy = !!val;

    // Only swap when truthiness actually changes
    if (isTruthy === wasTruthy) return;
    wasTruthy = isTruthy;

    if (currentDispose) currentDispose();
    for (const n of currentNodes) n.parentNode?.removeChild(n);
    currentNodes = [];

    pushDisposeScope();
    const result = isTruthy ? truthy() : (falsy ? falsy() : null);
    currentDispose = popDisposeScope();

    if (result && anchor.parentNode) {
      // Adopt into SVG namespace before capturing node refs — adoptSvg
      // returns fresh elements, so capture must happen post-adoption.
      const adopted = adoptIntoSvg(result, anchor.parentNode);
      currentNodes = adopted instanceof DocumentFragment
        ? [...adopted.childNodes]
        : [adopted];
      anchor.parentNode.insertBefore(adopted, anchor.nextSibling);
    }
  }

  effect(() => {
    sig.get(); // track
    if (!anchor.parentNode) {
      queueMicrotask(swap);
    } else {
      swap();
    }
  });

  // The active branch's scope is otherwise only disposed on the next
  // truthiness swap — without this, effects inside the branch outlive the
  // parent scope (route/component teardown) and keep writing to detached DOM.
  trackDispose(() => {
    if (currentDispose) currentDispose();
    currentDispose = null;
    for (const n of currentNodes) n.parentNode?.removeChild(n);
    currentNodes = [];
  });

  const frag = document.createDocumentFragment();
  frag.appendChild(anchor);
  return frag;
}

// === list() — keyed reactive list rendering ===
// Diffs by key to preserve DOM nodes across updates.
//
// Keyed form — render receives Signal<T> and Signal<number> so item
// updates flow into existing DOM without re-creating nodes:
//   list(items, (t) => t.id, (item$) => <li>{item$.map(t => t.name)}</li>)
//
// Non-keyed form (index-based, raw values):
//   list(items, (item, index) => <li>{item}</li>)

function collectNodes(result: Node): Node[] {
  return result instanceof DocumentFragment
    ? [...result.childNodes]
    : [result];
}

// Keyed form — render receives Signal<T> / Signal<number>. Real overloads (not
// a union-typed param) so the keyFn's item parameter is inferred from T; the
// bare-arrow form `list(rows, r => r.id, ...)` type-checks under strict.
export function list<T>(
  items: ReadonlySignal<T[]>,
  keyFn: (item: T) => string | number,
  render: (item: ReadonlySignal<T>, index: ReadonlySignal<number>) => Node,
): Node;
// Index-based form — render receives raw T.
export function list<T>(
  items: ReadonlySignal<T[]>,
  render: (item: T, index: number) => Node,
): Node;
export function list<T>(
  items: ReadonlySignal<T[]>,
  keyFnOrRender: ((item: T) => string | number) | ((item: T, index: number) => Node),
  maybeRender?: (item: ReadonlySignal<T>, index: ReadonlySignal<number>) => Node,
): Node {
  if (!hasActiveDisposeScope()) warnScopeless("list");
  const hasKeyFn = maybeRender !== undefined;
  const keyFn = hasKeyFn ? keyFnOrRender as (item: T) => string | number : null;

  type Entry = { nodes: Node[]; dispose: Dispose; item?: Signal<T>; index?: Signal<number> };
  const anchor = document.createComment("list");
  let entries: Map<string | number, Entry> = new Map();
  let order: (string | number)[] = [];

  function removeEntry(key: string | number) {
    const entry = entries.get(key);
    if (entry) {
      entry.dispose();
      for (const n of entry.nodes) n.parentNode?.removeChild(n);
      entries.delete(key);
    }
  }

  function clearAll() {
    for (const [, entry] of entries) {
      entry.dispose();
      for (const n of entry.nodes) n.parentNode?.removeChild(n);
    }
    entries = new Map();
    order = [];
  }

  function sync() {
    const arr = items.get();
    const parent = anchor.parentNode;
    if (!parent) return;

    const newKeys = arr.map((item, i) => keyFn ? keyFn(item) : i);
    const newKeySet = new Set(newKeys);

    // Duplicate keys collapse to one entry in the Map, silently dropping rows.
    // Warn rather than mis-render — keyFn must return a unique key per item.
    if (keyFn && newKeySet.size !== newKeys.length) {
      console.warn(
        "[railroad/list] duplicate keys detected — items sharing a key collapse " +
          "to a single row and others are dropped. keyFn must return a unique key per item.",
      );
    }

    // Remove entries no longer in the list
    for (const key of order) {
      if (!newKeySet.has(key)) removeEntry(key);
    }

    // Add or reorder entries
    let insertBefore: Node = anchor;
    for (let i = newKeys.length - 1; i >= 0; i--) {
      const key = newKeys[i]!;
      let entry = entries.get(key);

      if (!entry) {
        // New item — create
        pushDisposeScope();
        let result: Node;
        if (hasKeyFn) {
          const itemSig = signal(arr[i]!);
          const indexSig = signal(i);
          result = maybeRender!(itemSig, indexSig);
          result = adoptIntoSvg(result, parent);
          const dispose = popDisposeScope();
          entry = { nodes: collectNodes(result), dispose, item: itemSig, index: indexSig };
        } else {
          result = (keyFnOrRender as (item: T, index: number) => Node)(arr[i]!, i);
          result = adoptIntoSvg(result, parent);
          const dispose = popDisposeScope();
          entry = { nodes: collectNodes(result), dispose };
        }
        entries.set(key, entry);
      } else if (hasKeyFn) {
        // Existing keyed item — push new value into its signal
        entry.item!.set(arr[i]!);
        entry.index!.set(i);
      } else {
        // Index-based — dispose old, recreate with new item
        const oldNodes = entry.nodes;
        entry.dispose();
        pushDisposeScope();
        let result = (keyFnOrRender as (item: T, index: number) => Node)(arr[i]!, i);
        result = adoptIntoSvg(result, parent);
        const dispose = popDisposeScope();
        const nodes = collectNodes(result);
        entry = { nodes, dispose };
        entries.set(key, entry);
        const ref = oldNodes[oldNodes.length - 1]?.nextSibling ?? null;
        const oldParent = oldNodes[0]?.parentNode;
        for (const n of oldNodes) n.parentNode?.removeChild(n);
        if (oldParent) {
          for (const n of nodes) oldParent.insertBefore(n, ref);
        }
      }

      // Move or insert into correct position
      const lastNode = entry.nodes[entry.nodes.length - 1];
      if (lastNode?.nextSibling !== insertBefore) {
        for (const n of entry.nodes) {
          parent.insertBefore(n, insertBefore);
        }
      }
      insertBefore = entry.nodes[0] ?? insertBefore;
    }

    order = newKeys;
  }

  effect(() => {
    items.get(); // track
    if (!anchor.parentNode) {
      queueMicrotask(sync);
    } else {
      sync();
    }
  });

  trackDispose(() => clearAll());

  const frag = document.createDocumentFragment();
  frag.appendChild(anchor);
  return frag;
}

// === JSX namespace for TypeScript ===

declare global {
  namespace JSX {
    type Element = globalThis.Node;
    interface IntrinsicElements {
      [tag: string]: any;
    }
  }
}
