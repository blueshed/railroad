/**
 * JSX Runtime — real DOM elements backed by signals
 *
 * createElement(tag, props, ...children)
 *   - tag: string → creates HTML element (or SVG element inside <svg>)
 *   - tag: function → calls component function(props)
 *   - tag: async function → placeholder now, content when it resolves — the
 *     component must resolve to a THUNK (`return () => <div>…</div>`) so its
 *     post-await effects get an owner scope; optional `fallback` prop (a
 *     thunk) renders until settlement. See the async-components section.
 *   - props: attributes, event handlers (onclick etc), ref — applied after the
 *     children are appended, so a <select>'s value finds its <option>s and a
 *     ref sees the element whole
 *   - children: string, number, Node, Signal<T>, () => any, arrays, null/undefined
 *
 * When a Signal is used as a child, an effect auto-updates the text node.
 * When a function is used as a child, it auto-tracks dependencies:
 *   <span>{() => count.get() > 5 ? "High" : "Low"}</span>
 * When a Signal or a function is used as a prop value (other than ref and
 * on*), an effect auto-updates the attribute — same rule as children:
 *   <div class={() => open.get() ? "open" : ""} />
 * style accepts a CSS string or an object of properties, static or reactive.
 *
 * when() and list() render their initial content synchronously: it is in the
 * DOM as soon as the returned fragment is appended.
 *
 * Components are auto-scoped — effects/computeds inside are disposed when
 * the parent scope (route, when, list) tears down. No manual dispose needed.
 *
 * Render bodies are untracked: a component body, a when() branch and a list()
 * row run once, so a .get() there is a one-shot read that subscribes nothing
 * (not the when()/list() driving it, nor an effect that builds it). Pass the
 * signal itself, or a function, where the value should stay live.
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
 *   when(signal, truthy, falsy?)  — conditional rendering; rebuilds the branch
 *                                   only when the condition's truthiness flips
 *   list(signal, keyFn, render, options?) — keyed reactive list, render receives Signal<T>
 *   list(signal, render)          — index-based reactive list, render receives raw T
 *
 * when() and list() warn if created outside a dispose scope (a component,
 * routes() handler, when/list render, or mount()) — their internal effects
 * would be impossible to tear down.
 *
 * Types: railroad declares no global JSX namespace, so it sits beside React's
 * types in one app. `jsx: react` with `jsxFactory: "createElement"` finds the
 * types on the factory (createElement.JSX); `jsx: react-jsx` with
 * `jsxImportSource: "@blueshed/railroad"` finds jsx-runtime's JSX export. To
 * annotate: `import type { JSX } from "@blueshed/railroad"` (JSX.Element is Node).
 */

import { Signal, signal, effect, computed, untrack, pushDisposeScope, popDisposeScope, trackDispose, hasActiveDisposeScope } from "./signals";
import type { Dispose, ReadonlySignal, SignalOptions } from "./signals";

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

// Apply a style value: a CSS string (cssText) or an object of properties.
// `prev` carries what the last reactive value set — the object keys, or null
// after a string — so the next value can clear what it no longer names.
type StyleState = { keys: Set<string> | null };

function applyStyle(el: Element, v: unknown, prev: StyleState): void {
  const elStyle = (el as HTMLElement).style;
  if (v == null || v === false || typeof v === "string") {
    prev.keys = null;
    if (v == null || v === false || v === "") el.removeAttribute("style");
    else el.setAttribute("style", v);
    return;
  }
  // Coming from a string (or the first run), start from a clean attribute so
  // properties set by the old cssText don't linger under the object form.
  if (prev.keys === null) el.removeAttribute("style");
  const next = v as Record<string, string>;
  // A custom property (--x) exists only through setProperty; camelCase keys
  // are properties of the declaration.
  const set = (k: string, val: string) =>
    k.startsWith("--") ? elStyle.setProperty(k, val) : (elStyle[k as any] = val);
  for (const k of prev.keys ?? []) {
    if (!(k in next)) set(k, "");
  }
  prev.keys = new Set(Object.keys(next));
  for (const [k, val] of Object.entries(next)) set(k, val);
}

function applyProps(el: Element, props: Record<string, any>): void {
  const disposers: Dispose[] = [];
  for (const [key, value] of Object.entries(props)) {
    if (key === "ref") {
      if (typeof value === "function") value(el);
      continue;
    }
    if (key.startsWith("on")) {
      // A non-function here (a Signal, or an accidentally-invoked handler)
      // would be silently ignored by addEventListener — the element just
      // doesn't respond, with nothing to say why. null/undefined stay legal:
      // `onclick={maybeHandler}` is a real conditional-handler pattern.
      if (typeof value === "function") {
        el.addEventListener(key.slice(2).toLowerCase(), value);
      } else if (value != null) {
        console.warn(
          `[railroad/jsx] ${key} expects a function but got ` +
            (value instanceof Signal
              ? "a Signal — event handlers are not reactive; pass a function that reads it"
              : typeof value) +
            ". No listener was attached.",
        );
      }
      continue;
    }

    // Every other prop is reactive when given a Signal or a function — the
    // same rule as children, so `class={() => …}` tracks like `{() => …}`.
    // Anything else is applied once.
    let apply: (v: any) => void;
    if (key === "innerHTML") {
      apply = (v) => { el.innerHTML = v ?? ""; };
    } else if (key === "className" || key === "class") {
      apply = (v) => {
        if (v == null || v === false) el.removeAttribute("class");
        else el.setAttribute("class", String(v));
      };
    } else if (key === "value" || key === "checked" || key === "disabled" || key === "selected" || key === "srcdoc" || key === "src") {
      // Coerce null/undefined to "" so a cleared signal doesn't write the
      // literal string "null"/"undefined" into the DOM property.
      apply = (v) => { (el as any)[key] = v ?? ""; };
    } else if (key === "style") {
      const prev: StyleState = { keys: null };
      apply = (v) => applyStyle(el, v, prev);
    } else {
      // htmlFor is the DOM property's name; the attribute is `for`.
      const name = key === "htmlFor" ? "for" : key;
      apply = (v) => {
        if (v === false || v == null) el.removeAttribute(name);
        else el.setAttribute(name, String(v));
      };
    }

    if (value instanceof Signal) {
      disposers.push(effect(() => apply(value.get())));
    } else if (typeof value === "function") {
      disposers.push(effect(() => apply(value())));
    } else {
      apply(value);
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
    const componentProps: Record<string, any> = { ...props, children };
    pushDisposeScope();
    // finally (not a trailing pop) so a throwing component still balances the
    // dispose stack — otherwise the leaked scope corrupts every later push/pop.
    try {
      // Untracked: a component runs once, so a .get() in its body is a one-shot
      // read and must not subscribe whatever effect is building it.
      const result = untrack(() => tag(componentProps));
      if (result instanceof Promise) {
        // Async component. Its synchronous prefix (before the first await) ran
        // under this component scope and is captured by the finally below; the
        // continuation's creations are owned via the thunk contract — see
        // asyncComponent(). Called here, inside the scope, so its teardown
        // registers with the component and disposes with the parent.
        const name = tag.name || "anonymous";
        const fb = componentProps.fallback;
        if (fb != null && typeof fb !== "function") {
          console.warn(
            `[railroad/jsx] <${name}> fallback must be a thunk ` +
              `(fallback={() => <p>…</p>}) — got ${fb instanceof Node ? "a Node" : `a ${typeof fb}`}; ignoring.`,
          );
        }
        return asyncComponent(name, result, typeof fb === "function" ? fb : undefined);
      }
      return result;
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

  // Children first: a <select>'s value names one of its <option>s, and a ref
  // sees the element whole.
  appendChildren(el, children);
  if (props) {
    storedProps.set(el, props);
    applyProps(el, props);
  }
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
  // Adopt children recursively — except through <foreignObject>, whose
  // subtree is HTML content by definition and must keep its namespace. They
  // move before the props are re-applied, as createElement orders them.
  const isForeign = svgEl.localName === "foreignObject";
  while (node.firstChild) {
    const child = node.removeChild(node.firstChild);
    svgEl.appendChild(isForeign ? child : adoptSvg(child));
  }

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
/** @internal -- routes() places a handler's result with it, as mount() does. Not part of the API. */
export function adoptIntoSvg(result: Node, parent: Node | null): Node {
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

// === Async components — thunk resolution ===
//
// A function component may be async. Its synchronous prefix (before the first
// await) runs under the component's dispose scope like any component. The
// continuation is the hard part: browser JS has no AsyncContext, so no library
// can re-establish "current owner scope" around code that resumes after an
// await — which is why a bare `Promise<Node>` resolution can never have its
// post-await effects torn down. The contract that is correct today: the
// component RESOLVES TO A THUNK, giving railroad a synchronous moment it owns:
//
//   async function Profile() {
//     const user = await fetchUser();          // async work — no scope needed
//     return () => <div>{user.name}</div>;     // runs under a railroad scope
//   }
//   <Profile fallback={() => <p>loading…</p>} />
//
// createElement returns a bracketed placeholder immediately (rendering the
// optional `fallback` thunk until settlement). On resolution the thunk runs
// inside a fresh scope whose disposer joins the component's cleanup, so
// teardown is correct no matter when it happens — including before the
// promise settles (the thunk then never runs). A resolution that is a bare
// Node gets a pointed console.error naming the one-word fix.

function asyncComponent(
  name: string,
  pending: Promise<unknown>,
  fallback: (() => Node) | undefined,
): Node {
  const start = document.createComment(`async:${name}`);
  const end = document.createComment(`/async:${name}`);
  let currentDispose: Dispose | null = null;
  let disposed = false;

  // Content lives between the bracket comments (list()-row trick), so removal
  // stays correct even when SVG adoption swaps node identities after capture.
  const contentNodes = (): Node[] => {
    const nodes: Node[] = [];
    for (let n = start.nextSibling; n && n !== end; n = n.nextSibling) nodes.push(n);
    return nodes;
  };
  const clear = () => {
    if (currentDispose) currentDispose();
    currentDispose = null;
    for (const n of contentNodes()) n.parentNode?.removeChild(n);
  };

  const frag = document.createDocumentFragment();
  frag.appendChild(start);
  if (fallback) {
    // Own sub-scope so the fallback's effects die at the swap, not with the
    // whole component.
    pushDisposeScope();
    try {
      frag.appendChild(fallback());
    } finally {
      currentDispose = popDisposeScope();
    }
  }
  frag.appendChild(end);

  pending.then(
    (resolution) => {
      if (disposed) return;
      clear(); // the fallback goes on every settlement path
      if (typeof resolution !== "function") {
        console.error(
          `[railroad/jsx] <${name}> resolved to ${resolution instanceof Node ? "a Node" : "a non-thunk value"} — ` +
            "an async component must resolve to a thunk: `return () => <div>…</div>`. " +
            "Effects created after an await have no owner scope; the thunk gives railroad " +
            "a synchronous moment to provide one.",
        );
        return;
      }
      pushDisposeScope();
      let result: unknown;
      try {
        result = (resolution as () => unknown)();
      } catch (err) {
        popDisposeScope()();
        console.error(`[railroad/jsx] <${name}> async thunk threw:`, err);
        return;
      }
      currentDispose = popDisposeScope();
      if (!(result instanceof Node)) {
        currentDispose();
        currentDispose = null;
        console.error(`[railroad/jsx] <${name}> async thunk returned a non-Node — return DOM from the thunk.`);
        return;
      }
      const parent = end.parentNode;
      if (parent) {
        parent.insertBefore(adoptIntoSvg(result, parent), end);
      } else {
        // Brackets left the DOM without a dispose (out-of-contract removal) —
        // drop the built branch rather than leak it.
        currentDispose();
        currentDispose = null;
      }
    },
    (err) => {
      if (disposed) return;
      clear(); // a stuck fallback would hide the failure
      console.error(`[railroad/jsx] <${name}> async component rejected:`, err);
    },
  );

  trackDispose(() => {
    disposed = true;
    clear();
  });

  return frag;
}

// === Child rendering ===

function appendChildren(parent: Node, children: any[]): void {
  // foreignObject children are HTML by definition — never adopt them.
  const isSvgParent = parent instanceof Element &&
    parent.namespaceURI === SVG_NS &&
    parent.localName !== "foreignObject";

  for (const child of children.flat(Infinity)) {
    if (child == null || child === false || child === true) continue;

    if (child instanceof Signal || typeof child === "function") {
      // A reactive text node. Its value renders as a static child's would:
      // null, undefined and booleans as nothing.
      const read: () => unknown = child instanceof Signal ? () => child.get() : child;
      const textNode = document.createTextNode("");
      let warnedNode = false;
      effect(() => {
        const v = read();
        if (!warnedNode && v instanceof Node) {
          warnedNode = true;
          console.warn(
            "[railroad/jsx] A reactive child held a DOM Node; it is rendered " +
              "as text, not inserted as an element. To render elements reactively, " +
              "use when() or list().",
          );
        }
        textNode.textContent = v == null || typeof v === "boolean" ? "" : String(v);
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
  // The branch lives between two bracket comments (the list()-row trick), so
  // removal stays correct even when SVG adoption swaps node identities after
  // render, and nodes a nested when()/list() inserts later travel with it.
  const anchor = document.createComment("when");
  const end = document.createComment("/when");
  let currentDispose: Dispose | null = null;
  let wasTruthy: boolean | undefined = undefined;
  let disposed = false;

  // Brackets go into the fragment BEFORE the effect runs, so the first branch
  // renders synchronously — it is in the DOM when mount()/appendChild returns.
  const frag = document.createDocumentFragment();
  frag.appendChild(anchor);
  frag.appendChild(end);

  const sig: ReadonlySignal<any> = typeof condition === "function"
    ? computed(condition)
    : condition;

  function clear() {
    if (currentDispose) currentDispose();
    currentDispose = null;
    for (let n = anchor.nextSibling; n && n !== end; n = anchor.nextSibling) {
      n.parentNode!.removeChild(n);
    }
  }

  function swap() {
    // An anchor.parentNode check is not enough to detect teardown — after a
    // routes() teardown the anchor can still sit in a detached-but-parented
    // subtree — so a disposed when() refuses to rebuild explicitly.
    if (disposed) return;
    const parent = anchor.parentNode;
    if (!parent) return; // brackets removed out of contract — nowhere to render
    const isTruthy = !!sig.get();

    // Only swap when truthiness actually changes
    if (isTruthy === wasTruthy) return;
    wasTruthy = isTruthy;

    clear();
    pushDisposeScope();
    let result: Node | null;
    try {
      result = isTruthy ? truthy() : (falsy ? falsy() : null);
    } finally {
      currentDispose = popDisposeScope();
    }
    if (result) parent.insertBefore(adoptIntoSvg(result, parent), end);
  }

  // Only the condition is tracked; the branch renders untracked, so a .get()
  // inside it doesn't re-run this effect.
  effect(() => {
    sig.get();
    untrack(swap);
  });

  // The active branch's scope is otherwise only disposed on the next
  // truthiness swap — without this, effects inside the branch outlive the
  // parent scope (route/component teardown) and keep writing to detached DOM.
  trackDispose(() => {
    disposed = true;
    clear();
  });

  return frag;
}

// === list() — keyed reactive list rendering ===
// Diffs by key to preserve DOM nodes across updates. A reorder moves only the
// rows outside the longest run already in order, so a row that didn't move
// keeps its focus, selection and scroll position.
//
// Keyed form — render receives Signal<T> and Signal<number> so item
// updates flow into existing DOM without re-creating nodes:
//   list(items, (t) => t.id, (item$) => <li>{item$.map(t => t.name)}</li>)
//
// Non-keyed form (index-based, raw values):
//   list(items, (item, index) => <li>{item}</li>)
//
// Each row is bracketed by <!--row--> / <!--/row--> comment markers, so nodes
// that a when() (or nested list()) at the row's top level inserts beside its
// anchor after render time still move and remove with the row.
//
// options (keyed form) forwards SignalOptions to each row's item signal. The
// default Object.is is right for immutable updates (a changed row is a new
// object), but a patch stream that MUTATES row objects in place and notifies
// via touch() (delta docs, hand-rolled applyPatch) re-delivers the same
// reference — which Object.is swallows, leaving row DOM stale. Pass
// { equals: () => false } to force per-row re-projection; the row's own
// .map() computeds still bail on unchanged values, so DOM writes stay minimal.

// Keyed form — render receives Signal<T> / Signal<number>. Real overloads (not
// a union-typed param) so the keyFn's item parameter is inferred from T; the
// bare-arrow form `list(rows, r => r.id, ...)` type-checks under strict.
export function list<T>(
  items: ReadonlySignal<T[]>,
  keyFn: (item: T) => string | number,
  render: (item: ReadonlySignal<T>, index: ReadonlySignal<number>) => Node,
  options?: SignalOptions<T>,
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
  options?: SignalOptions<T>,
): Node {
  if (!hasActiveDisposeScope()) warnScopeless("list");
  const hasKeyFn = maybeRender !== undefined;
  const keyFn = hasKeyFn ? keyFnOrRender as (item: T) => string | number : null;

  // A row's node array snapshotted at render time goes stale: a when() (or
  // nested list()) at the row's top level inserts nodes NEXT TO its anchor
  // later (branch changes), and moving just the snapshot
  // would strand them. The bracket range [start..end] is the row's live DOM —
  // it is what reorders move and removals delete.
  type Entry = { start: Comment; end: Comment; dispose: Dispose; item?: Signal<T>; index?: Signal<number> };
  const anchor = document.createComment("list");
  // Anchor goes into the fragment BEFORE the effect runs, so the first sync
  // renders rows synchronously (into the fragment, which the caller appends).
  const frag = document.createDocumentFragment();
  frag.appendChild(anchor);
  let entries: Map<string | number, Entry> = new Map();
  let order: (string | number)[] = [];
  let disposed = false;

  function rangeOf(entry: Entry): Node[] {
    const nodes: Node[] = [];
    for (let n: Node | null = entry.start; n; n = n.nextSibling) {
      nodes.push(n);
      if (n === entry.end) break;
    }
    return nodes;
  }

  function removeEntry(key: string | number) {
    const entry = entries.get(key);
    if (entry) {
      const range = rangeOf(entry); // snapshot before dispose mutates the row
      entry.dispose();
      for (const n of range) n.parentNode?.removeChild(n);
      entries.delete(key);
    }
  }

  function clearAll() {
    for (const [, entry] of entries) {
      const range = rangeOf(entry);
      entry.dispose();
      for (const n of range) n.parentNode?.removeChild(n);
    }
    entries = new Map();
    order = [];
  }

  function sync() {
    // Same guard as when()'s swap: a disposed list must not rebuild rows. The
    // parent check below doesn't cover an anchor still sitting in a
    // detached-but-parented subtree after a routes()/component teardown.
    if (disposed) return;
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

    // The rows in the longest run already in order stay put (see above).
    const oldPos = new Map(order.map((k, i) => [k, i]));
    const stay = longestIncreasing(newKeys.map((k) => oldPos.get(k) ?? -1));

    // Add or reorder entries
    let insertBefore: Node = anchor;
    for (let i = newKeys.length - 1; i >= 0; i--) {
      const key = newKeys[i]!;
      let entry = entries.get(key);

      if (!entry) {
        // New item — render between fresh brackets in a detached fragment;
        // the shared move step below inserts the whole range into position.
        const start = document.createComment("row");
        const end = document.createComment("/row");
        pushDisposeScope();
        let result: Node;
        if (hasKeyFn) {
          const itemSig = signal(arr[i]!, options);
          const indexSig = signal(i);
          result = maybeRender!(itemSig, indexSig);
          result = adoptIntoSvg(result, parent);
          const dispose = popDisposeScope();
          entry = { start, end, dispose, item: itemSig, index: indexSig };
        } else {
          result = (keyFnOrRender as (item: T, index: number) => Node)(arr[i]!, i);
          result = adoptIntoSvg(result, parent);
          const dispose = popDisposeScope();
          entry = { start, end, dispose };
        }
        const frag = document.createDocumentFragment();
        frag.appendChild(start);
        frag.appendChild(result);
        frag.appendChild(end);
        entries.set(key, entry);
      } else if (hasKeyFn) {
        // Existing keyed item — push new value into its signal
        entry.item!.set(arr[i]!);
        entry.index!.set(i);
      } else {
        // Index-based — dispose the old content and rebuild it between the
        // same brackets, which keeps the row's position without re-inserting.
        const { start, end } = entry;
        const oldContent = rangeOf(entry).filter((n) => n !== start && n !== end);
        entry.dispose();
        for (const n of oldContent) n.parentNode?.removeChild(n);
        pushDisposeScope();
        let result = (keyFnOrRender as (item: T, index: number) => Node)(arr[i]!, i);
        result = adoptIntoSvg(result, parent);
        entry.dispose = popDisposeScope();
        end.parentNode?.insertBefore(result, end);
      }

      // Move or insert into correct position — the whole bracket range, so
      // nodes a when()/list() inserted beside its anchor travel with the row.
      if (!stay.has(i) && entry.end.nextSibling !== insertBefore) {
        for (const n of rangeOf(entry)) parent.insertBefore(n, insertBefore);
      }
      insertBefore = entry.start;
    }

    order = newKeys;
  }

  // Only the items are tracked; rows render untracked, so a .get() inside a
  // row doesn't re-run the whole list.
  effect(() => {
    items.get();
    untrack(sync);
  });

  trackDispose(() => {
    disposed = true;
    clearAll();
  });

  return frag;
}

// The positions of a longest strictly increasing run in `seq`, skipping
// negative entries (rows that are new). Patience sorting, O(n log n).
function longestIncreasing(seq: number[]): Set<number> {
  const tails: number[] = []; // tails[k]: position ending the best run of length k+1
  const prev: number[] = [];
  for (let i = 0; i < seq.length; i++) {
    const v = seq[i]!;
    if (v < 0) continue;
    let lo = 0;
    let hi = tails.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (seq[tails[mid]!]! < v) lo = mid + 1;
      else hi = mid;
    }
    prev[i] = lo > 0 ? tails[lo - 1]! : -1;
    tails[lo] = i;
  }
  const run = new Set<number>();
  for (let i = tails.length ? tails[tails.length - 1]! : -1; i >= 0; i = prev[i]!) run.add(i);
  return run;
}

// === JSX namespace for TypeScript ===
//
// No global JSX: a global one clashes with React's in a mixed app (TS2300
// Duplicate identifier 'Element'). Each JSX mode finds these types without it:
//   jsx: react (jsxFactory createElement) — TypeScript looks the namespace up
//     on the factory, createElement.JSX, before any global;
//   jsx: react-jsx (jsxImportSource) — the JSX that jsx-runtime.ts exports.
// To annotate, import it: `import type { JSX } from "@blueshed/railroad"`.

export declare namespace createElement {
  export namespace JSX {
    export type Element = globalThis.Node;
    // Admits async components (thunk resolution) as JSX tags — TS 5.1+.
    export type ElementType =
      | string
      | ((props: any) => globalThis.Node | Promise<() => globalThis.Node>);
    export interface IntrinsicAttributes {
      /** Loading view for an async component — rendered immediately, swapped
       *  out when the component's promise settles. Sync components ignore it. */
      fallback?: () => globalThis.Node;
    }
    export interface IntrinsicElements {
      [tag: string]: any;
    }
  }
}

/** Railroad's JSX types, the same ones `createElement.JSX` holds:
 *  `import type { JSX } from "@blueshed/railroad"`. */
export declare namespace JSX {
  export type Element = createElement.JSX.Element;
  export type ElementType = createElement.JSX.ElementType;
  export interface IntrinsicAttributes extends createElement.JSX.IntrinsicAttributes {}
  export interface IntrinsicElements extends createElement.JSX.IntrinsicElements {}
}
