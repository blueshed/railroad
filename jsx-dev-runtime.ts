// Development JSX runtime — re-exports the production runtime.
// Required for TypeScript's "jsx": "react-jsxdev" mode.

export { jsx, jsx as jsxDEV, jsxs, Fragment, type JSX } from "./jsx-runtime";
