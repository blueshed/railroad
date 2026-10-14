# The server

```ts
// server.ts
import homepage from "./index.html";
import aboutPage from "./about/about.html";

const server = Bun.serve({
  port: process.env.PORT || 3000,
  routes: {
    "/": homepage,
    "/about": aboutPage,
    "/api/users": {
      GET: () => Response.json([]),
      POST: async (req) => Response.json(await req.json(), { status: 201 }),
    },
    "/api/users/:id": (req) => Response.json({ id: req.params.id }),
  },
  development: process.env.NODE_ENV !== "production" && { hmr: true, console: true },
});

console.log(`Listening on ${server.url}`);
```

An imported HTML file is a route: Bun scans its `<script>` and `<link>` tags, bundles them, rewrites the paths with content hashes and serves the assets. The route and handler types are Bun's (`Bun.serve` in `@types/bun`).

- Always turn on `hmr` (`import.meta.hot`) and `console` (browser `console.*` mirrored to the terminal) in development, and gate them on `NODE_ENV` yourself: Bun serves the HMR client under `NODE_ENV=production` if `development.hmr` is set.
- Use `Bun.serve`. An existing `import { serve } from "bun"` also works; leave it.
- A handler that returns `Bun.file(...)` gets `Range` requests (`206 Partial Content`) for free, so `<video>` and `<audio>` seek (Bun 1.3.13+).

## Build and deploy

```sh
bun build ./index.html --production --outdir=dist   # hashed static assets, host anywhere
bun build --compile server.ts --outfile myapp       # server, client and runtime in one binary
./myapp
```

- `--compile` follows the HTML imports in `server.ts`; cross-compile with `--target=bun-linux-x64` and the like.
- `--target=bun` keeps `using`/`await using` native (Bun 1.3.14+), so the tests' `await using view` compiles.
