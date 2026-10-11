// The README's server, as it is written there: HMR and console mirroring in development only.
import home from "./app.html";

const server = Bun.serve({
  port: Number(process.env.PORT ?? 3000),
  routes: { "/": home },
  development: process.env.NODE_ENV !== "production" && { hmr: true, console: true },
});

console.log(`Listening on ${server.url}`);
