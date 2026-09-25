/**
 * Automatic JSX Runtime for Railroad
 *
 * Enables "jsx": "react-jsx" / jsxImportSource so consumers
 * can write JSX without importing createElement.
 *
 * tsconfig.json:
 *   { "jsx": "react-jsx", "jsxImportSource": "@blueshed/railroad" }
 *
 * TypeScript finds the JSX types in this module's `JSX` export; railroad
 * declares no global JSX namespace (see jsx.ts).
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

// TypeScript's react-jsx mode finds the JSX types here, on the runtime module;
// railroad declares no global JSX (see jsx.ts).
export type { JSX } from "./jsx";
