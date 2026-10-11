import home from "./index.html";

Bun.serve({
  routes: { "/": home },
  development: process.env.NODE_ENV !== "production" && { hmr: true, console: true },
});
