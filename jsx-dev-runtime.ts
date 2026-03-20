// Development JSX runtime — re-exports the production runtime.
// Required for TypeScript's "jsx": "react-jsxdev" mode.

export { jsx, jsxs, Fragment } from "./jsx-runtime";
