/**
 * Automatic JSX Runtime for Railroad
 *
 * Enables "jsx": "react-jsx" / jsxImportSource so consumers
 * can write JSX without importing createElement.
 *
 * tsconfig.json:
 *   { "jsx": "react-jsx", "jsxImportSource": "@blueshed/railroad" }
 */

import { createElement, Fragment } from "./jsx";

export { Fragment };

export function jsx(
  type: string | Function,
  props: Record<string, any> | null,
  _key?: string,
): Node {
  if (!props) return createElement(type, null);
  const { children, ...rest } = props;
  if (children === undefined) return createElement(type, rest);
  if (Array.isArray(children)) return createElement(type, rest, ...children);
  return createElement(type, rest, children);
}

export { jsx as jsxs };

// Re-export JSX namespace so TypeScript react-jsx mode finds the types
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
