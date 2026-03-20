/**
 * JSX Runtime — real DOM elements backed by signals
 *
 * createElement(tag, props, ...children)
 *   - tag: string → creates HTML element
 *   - tag: function → calls component function(props)
 *   - props: attributes, event handlers (onclick etc), ref
 *   - children: string, number, Node, Signal<T>, arrays, null/undefined
 *
 * When a Signal is used as a child, an effect auto-updates the text node.
 * When a Signal is used as a prop value, an effect auto-updates the attribute.
 *
 * Reactive helpers:
 *   when(signal, truthy, falsy?)  — conditional rendering, swaps DOM nodes
 *   list(signal, render)          — reactive list, diffs by index
 *   text(fn)                      — reactive text from computed expression
 */

import { Signal, effect, computed } from "./signals";
import type { Dispose } from "./signals";

// === Dispose scope management ===

const disposeStack: Dispose[][] = [];

export function pushDisposeScope(): void {
  disposeStack.push([]);
}

export function popDisposeScope(): Dispose {
  const disposers = disposeStack.pop() || [];
  return () => disposers.forEach((d) => d());
}

function trackDispose(d: Dispose): void {
  const scope = disposeStack[disposeStack.length - 1];
  if (scope) scope.push(d);
}

// === Fragment ===

export function Fragment(_props: any, ...children: any[]): DocumentFragment {
  const frag = document.createDocumentFragment();
  appendChildren(frag, children);
  return frag;
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

  const el = document.createElement(tag);

  if (props) {
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
          trackDispose(effect(() => { el.className = value.get(); }));
        } else {
          el.className = value;
        }
      } else if (key === "value" || key === "checked" || key === "disabled" || key === "selected") {
        if (value instanceof Signal) {
          trackDispose(effect(() => { (el as any)[key] = value.get(); }));
        } else {
          (el as any)[key] = value;
        }
      } else if (key === "style" && typeof value === "object" && !(value instanceof Signal)) {
        Object.assign(el.style, value);
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

  appendChildren(el, children);
  return el;
}

// === Child rendering ===

function appendChildren(parent: Node, children: any[]): void {
  for (const child of children.flat(Infinity)) {
    if (child == null || child === false || child === true) continue;

    if (child instanceof Signal) {
      const text = document.createTextNode(String(child.peek()));
      trackDispose(effect(() => {
        text.textContent = String(child.get());
      }));
      parent.appendChild(text);
    } else if (child instanceof Node) {
      parent.appendChild(child);
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
// Swaps DOM nodes when signal/computed value changes truthiness.
//   when(isLoggedIn, () => <Dashboard />, () => <Login />)

export function when(
  condition: Signal<any> | (() => any),
  truthy: () => Node,
  falsy?: () => Node,
): Node {
  const anchor = document.createComment("when");
  let current: Node | null = null;
  let currentDispose: Dispose | null = null;

  const sig = typeof condition === "function" ? computed(condition) : condition;

  function swap() {
    const val = sig.get();

    if (currentDispose) currentDispose();
    if (current && anchor.parentNode) {
      anchor.parentNode.removeChild(current);
    }

    pushDisposeScope();
    current = val ? truthy() : (falsy ? falsy() : null);
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
//   list(items, (item) => item.id, (item, index) => <li>{item.name}</li>)
// Or without key function (falls back to index):
//   list(items, (item, index) => <li>{item}</li>)

export function list<T>(
  items: Signal<T[]>,
  keyFnOrRender: ((item: T) => string | number) | ((item: T, index: number) => Node),
  maybeRender?: (item: T, index: number) => Node,
): Node {
  const hasKeyFn = maybeRender !== undefined;
  const keyFn = hasKeyFn ? keyFnOrRender as (item: T) => string | number : null;
  const render = hasKeyFn ? maybeRender! : keyFnOrRender as (item: T, index: number) => Node;

  const anchor = document.createComment("list");
  let entries: Map<string | number, { node: Node; dispose: Dispose }> = new Map();
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
      const key = newKeys[i];
      let entry = entries.get(key);

      if (!entry) {
        // New item — create
        pushDisposeScope();
        const node = render(arr[i], i);
        const dispose = popDisposeScope();
        entry = { node, dispose };
        entries.set(key, entry);
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
