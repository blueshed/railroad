// Railroad — Signals, JSX, and Routes

export { Signal, signal, computed, effect, batch } from "./signals";
export type { Dispose } from "./signals";

export {
  createElement, Fragment,
  text, when, list,
  pushDisposeScope, popDisposeScope,
} from "./jsx";

export { routes, route, navigate, matchRoute } from "./routes";

export { key, provide, inject } from "./shared";
export type { Key } from "./shared";
