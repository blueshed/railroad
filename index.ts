// Railroad — Signals, JSX, Routes, and Delta-doc

export { Signal, signal, computed, effect, batch, untrack } from "./signals";
// Dispose-scope primitives — for advanced cases that mount UI outside a
// component/route/mount(). trackDispose registers a cleanup in the current
// scope; push/pop bracket a manual scope. App code rarely needs these.
export { trackDispose, pushDisposeScope, popDisposeScope, hasActiveDisposeScope } from "./signals";
export type { Dispose, ReadonlySignal, SignalOptions } from "./signals";

export {
  createElement, Fragment,
  when, list, mount,
} from "./jsx";

export { routes, route, navigate, matchRoute } from "./routes";

export { key, provide, inject, tryInject, clearProviders } from "./shared";
export type { Key } from "./shared";

export { createLogger, setLogLevel, getLogLevel, loggedRequest } from "./logger";
export type { LogLevel } from "./logger";
