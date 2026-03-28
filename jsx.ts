/**
 * JSX Runtime — real DOM elements backed by signals
 *
 * createElement(tag, props, ...children)
 *   - tag: string → creates HTML element (or SVG element inside <svg>)
 *   - tag: function → calls component function(props)
 *   - props: attributes, event handlers (onclick etc), ref
 *   - children: string, number, Node, Signal<T>, arrays, null/undefined
 *
 * When a Signal is used as a child, an effect auto-updates the text node.
 * When a Signal is used as a prop value, an effect auto-updates the attribute.
 *
 * SVG support:
 *   <svg> is created with the SVG namespace. Any HTML children appended to
 *   an SVG-namespaced parent are automatically adopted into the SVG namespace.
 *   This handles the JSX bottom-up evaluation order transparently — you can
 *   write <svg><g><circle /></g></svg> and it just works.
 *
 * Reactive helpers:
 *   when(signal, truthy, falsy?)  — conditional rendering, swaps DOM nodes
 *   list(signal, keyFn, render)   — keyed reactive list, render receives Signal<T>
 *   list(signal, render)          — index-based reactive list, render receives raw T
 *   text(fn)                      — reactive text from computed expression
 */

import { Signal, signal, effect, computed, pushDisposeScope, popDisposeScope, trackDispose } from "./signals";
import type { Dispose } from "./signals";

export { pushDisposeScope, popDisposeScope };

// === SVG namespace ===

const SVG_NS = "http://www.w3.org/2000/svg";
const storedProps = new WeakMap<Element, Record<string, any>>();

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
  for (const [key, value] of Object.entries(props)) {
    if (key === "ref") {
      if (typeof value === "function") value(el);
    } else if (key === "innerHTML") {
      if (value instanceof Signal) {
        trackDispose(effect(() => { el.innerHTML = value.get(); }));
      } else {
        el.innerHTML = value;
      }
    } else if (key === "className" || key === "class") {
      if (value instanceof Signal) {
        trackDispose(effect(() => { el.setAttribute("class", value.get()); }));
      } else {
        el.setAttribute("class", value);
      }
    } else if (key === "value" || key === "checked" || key === "disabled" || key === "selected" || key === "srcdoc" || key === "src") {
      if (value instanceof Signal) {
        trackDispose(effect(() => { (el as any)[key] = value.get(); }));
      } else {
        (el as any)[key] = value;
      }
    } else if (key === "style" && value instanceof Signal) {
      trackDispose(effect(() => { Object.assign((el as HTMLElement).style, value.get()); }));
    } else if (key === "style" && typeof value === "object") {
      Object.assign((el as HTMLElement).style, value);
    } else if (key.startsWith("on")) {
      el.addEventListener(key.slice(2).toLowerCase(), value);
    } else {
      if (value instanceof Signal) {
        trackDispose(effect(() => {
          const v = value.get();
          if (v === false || v == null) el.removeAttribute(key);
          else el.setAttribute(key, String(v));
        }));
      } else if (value !== false && value != null) {
        el.setAttribute(key, String(value));
      }
    }
  }
}

// === createElement ===

export function createElement(
  tag: string | Function,
  props: Record<string, any> | null,
  ...children: any[]
): Node {
  if (typeof tag === "function") {
    const componentProps = { ...props, children };
    return tag(componentProps);
  }

  // SVG root element is always created with the SVG namespace.
  // Child SVG elements are adopted in appendChildren when appended
  // to an SVG-namespaced parent.
  const el = tag === "svg"
    ? document.createElementNS(SVG_NS, tag)
    : document.createElement(tag);

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

  const svgEl = document.createElementNS(SVG_NS, node.localName);
  const props = storedProps.get(node);

  if (props) {
    storedProps.set(svgEl, props);
    applyProps(svgEl, props);
  } else {
    // No stored props — copy attributes directly
    for (let i = 0; i < node.attributes.length; i++) {
      const attr = node.attributes[i]!;
      svgEl.setAttribute(attr.name, attr.value);
    }
  }

  // Adopt children recursively
  while (node.firstChild) {
    svgEl.appendChild(adoptSvg(node.removeChild(node.firstChild)));
  }

  return svgEl;
}

// === Child rendering ===

function appendChildren(parent: Node, children: any[]): void {
  const isSvgParent = parent instanceof Element &&
    parent.namespaceURI === SVG_NS;

  for (const child of children.flat(Infinity)) {
    if (child == null || child === false || child === true) continue;

    if (child instanceof Signal) {
      const text = document.createTextNode(String(child.peek()));
      trackDispose(effect(() => {
        text.textContent = String(child.get());
      }));
      parent.appendChild(text);
    } else if (child instanceof Node) {
      // Adopt HTML elements into SVG namespace when parent is SVG
      if (isSvgParent &&
          child instanceof Element &&
          child.namespaceURI !== SVG_NS) {
        parent.appendChild(adoptSvg(child));
      } else {
        parent.appendChild(child);
      }
    } else {
      parent.appendChild(document.createTextNode(String(child)));
    }
  }
}

// === text() — reactive computed text node ===
// Use for expressions: text(() => count.get() > 5 ? "High" : "Low")

export function text(fn: () => string): Node {
  const value = computed(fn);
  const node = document.createTextNode(value.peek());
  trackDispose(effect(() => {
    node.textContent = value.get();
  }));
  return node;
}

// === when() — conditional rendering ===
// Swaps DOM nodes only when truthiness transitions (falsy↔truthy).
// Value changes within the same branch (e.g. "a" → "b") do NOT re-render.
// Components inside each branch should use signals to react to value changes.
//   when(isLoggedIn, () => <Dashboard />, () => <Login />)

export function when(
  condition: Signal<any> | (() => any),
  truthy: () => Node,
  falsy?: () => Node,
): Node {
  const anchor = document.createComment("when");
  let current: Node | null = null;
  let currentDispose: Dispose | null = null;
  let wasTruthy: boolean | undefined = undefined;

  const sig = typeof condition === "function" ? computed(condition) : condition;

  function swap() {
    const val = sig.get();
    const isTruthy = !!val;

    // Only swap when truthiness actually changes
    if (isTruthy === wasTruthy) return;
    wasTruthy = isTruthy;

    if (currentDispose) currentDispose();
    if (current && anchor.parentNode) {
      anchor.parentNode.removeChild(current);
    }

    pushDisposeScope();
    current = isTruthy ? truthy() : (falsy ? falsy() : null);
    currentDispose = popDisposeScope();

    if (current && anchor.parentNode) {
      anchor.parentNode.insertBefore(current, anchor.nextSibling);
    }
  }

  trackDispose(effect(() => {
    sig.get(); // track
    if (!anchor.parentNode) {
      queueMicrotask(swap);
    } else {
      swap();
    }
  }));

  // Return a fragment: anchor + initial content
  const frag = document.createDocumentFragment();
  frag.appendChild(anchor);
  if (current) frag.appendChild(current);
  return frag;
}

// === list() — keyed reactive list rendering ===
// Diffs by key to preserve DOM nodes across updates.
//
// Keyed form — render receives Signal<T> and Signal<number> so item
// updates flow into existing DOM without re-creating nodes:
//   list(items, (t) => t.id, (item, index) => <li>{text(() => item.get().name)}</li>)
//
// Non-keyed form (index-based, raw values):
//   list(items, (item, index) => <li>{item}</li>)

export function list<T>(
  items: Signal<T[]>,
  keyFnOrRender: ((item: T) => string | number) | ((item: T, index: number) => Node),
  maybeRender?: (item: Signal<T>, index: Signal<number>) => Node,
): Node {
  const hasKeyFn = maybeRender !== undefined;
  const keyFn = hasKeyFn ? keyFnOrRender as (item: T) => string | number : null;

  type Entry = { node: Node; dispose: Dispose; item?: Signal<T>; index?: Signal<number> };
  const anchor = document.createComment("list");
  let entries: Map<string | number, Entry> = new Map();
  let order: (string | number)[] = [];

  function removeEntry(key: string | number) {
    const entry = entries.get(key);
    if (entry) {
      entry.dispose();
      entry.node.parentNode?.removeChild(entry.node);
      entries.delete(key);
    }
  }

  function clearAll() {
    for (const [, entry] of entries) {
      entry.dispose();
      entry.node.parentNode?.removeChild(entry.node);
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
        let node: Node;
        if (hasKeyFn) {
          const itemSig = signal(arr[i]!);
          const indexSig = signal(i);
          node = maybeRender!(itemSig, indexSig);
          const dispose = popDisposeScope();
          entry = { node, dispose, item: itemSig, index: indexSig };
        } else {
          node = (keyFnOrRender as (item: T, index: number) => Node)(arr[i]!, i);
          const dispose = popDisposeScope();
          entry = { node, dispose };
        }
        entries.set(key, entry);
      } else if (hasKeyFn) {
        // Existing keyed item — push new value into its signal
        entry.item!.set(arr[i]!);
        entry.index!.set(i);
      } else {
        // Index-based — dispose old, recreate with new item
        const oldNode = entry.node;
        entry.dispose();
        pushDisposeScope();
        const node = (keyFnOrRender as (item: T, index: number) => Node)(arr[i]!, i);
        const dispose = popDisposeScope();
        entry = { node, dispose };
        entries.set(key, entry);
        if (oldNode.parentNode) oldNode.parentNode.replaceChild(node, oldNode);
      }

      // Move or insert into correct position
      if (entry.node.nextSibling !== insertBefore) {
        parent.insertBefore(entry.node, insertBefore);
      }
      insertBefore = entry.node;
    }

    order = newKeys;
  }

  trackDispose(effect(() => {
    items.get(); // track
    if (!anchor.parentNode) {
      queueMicrotask(sync);
    } else {
      sync();
    }
  }));

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
