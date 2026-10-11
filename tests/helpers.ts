// Small helpers shared by the unit tests (signals, jsx, routes).

export const SVG_NS = "http://www.w3.org/2000/svg";

// happy-dom dispatches `hashchange` on the next macrotask, not as a microtask:
// a setTimeout covers both.
export const tick = () => new Promise<void>((r) => setTimeout(r, 0));

// One microtask: a promise that has resolved has run its then().
export const flush = () => new Promise<void>((r) => queueMicrotask(() => r()));

// A promise with its resolve and reject in hand.
export function defer<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}
