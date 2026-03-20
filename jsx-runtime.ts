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
