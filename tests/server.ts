import { serve } from "bun";
import appHtml from "./fixtures/app.html";

export interface StartOptions {
  port?: number;
}

export async function startServer(opts: StartOptions = {}) {
  const server = serve({
    port: opts.port ?? Number(process.env.PORT ?? 3000),
    routes: { "/": appHtml },
    development: false,
  });
  return { server };
}

if (import.meta.main) {
  const { server } = await startServer();
  console.log(`Listening on ${server.url}`);
}
