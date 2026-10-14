# Shared (DI) and the logger

```ts
// store.ts
import { key, provide, inject, tryInject, createLogger, loggedRequest } from "@blueshed/railroad";

type Store = { hello: (name: string) => string };
export const STORE = key<Store>("store");          // export the one key; don't re-create it

provide(STORE, { hello: (n) => `hi ${n}` });
inject(STORE).hello("world");                      // throws "No provider for store" if missing
tryInject(STORE);                                  // undefined instead

const log = createLogger("[server]");
log.info("listening");                             // 12:34:56.789 INFO  [server] listening
log.debug("tick");                                 // only at LOG_LEVEL=debug

Bun.serve({
  routes: { "/api/hello": loggedRequest("[api]", () => new Response("ok")) },
});
```

Signatures: `shared.ts` and `logger.ts`.

- `key()` returns a fresh symbol each call: two `key("store")` are different keys. Share the exported one.
- The registry is one process-global map: right for client apps and app-wide services; on a server it is shared by every request, so never per-request state.
- Presence is by key: `provide(k, undefined)` is a real registration, which `inject(k)` returns without throwing. `tryInject` can't tell it from absent.
- `clearProviders()` resets the registry between tests.
- `LOG_LEVEL` (in `.env`, or `setLogLevel()`) is `silent`, `error`, `warn`, `info` or `debug`; an unknown value falls back to `info`.
- `loggedRequest(tag, handler)` logs method, path, status and time; a throw is logged and re-thrown.
