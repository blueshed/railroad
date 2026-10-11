// What README.md and the skills promise about serving and building, run as written.
// tests/fixtures/readme is the README's files byte for byte (the first test checks).
// Servers run in child processes, and happy-dom (preloaded here) replaces fetch and
// Response, so pages are fetched with Bun.fetch.

import { test, expect, setDefaultTimeout } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";

setDefaultTimeout(30_000);

const here = import.meta.dir;
const readmeDir = `${here}/fixtures/readme`;

test("the README's files are tests/fixtures/readme, as written", async () => {
  const readme = await Bun.file(`${here}/../README.md`).text();
  const files = [["tsconfig.json", "json"], ["index.html", "html"], ["app.tsx", "tsx"], ["server.ts", "ts"]] as const;
  for (const [name, lang] of files) {
    const block = readme.match(new RegExp("```" + lang + "\\n[^\\n]*" + name.replace(".", "\\.") + "[^\\n]*\\n([\\s\\S]*?)```"));
    expect(await Bun.file(`${readmeDir}/${name}`).text()).toBe(block![1]!);
  }
});

// Runs `cmd` (a server that takes its port from PORT, as Bun.serve does), waits until it
// answers, hands its URL to `use`, and stops it however `use` ends.
async function withServer<T>(cmd: string[], env: Record<string, string>, cwd: string, use: (url: string) => Promise<T>): Promise<T> {
  const probe = Bun.listen({ hostname: "localhost", port: 0, socket: { data() {} } });
  const url = `http://localhost:${probe.port}/`;
  probe.stop(true);
  const proc = Bun.spawn(cmd, { cwd, env: { ...process.env, ...env, PORT: new URL(url).port }, stdout: "ignore" });
  try {
    for (let tries = 0; ; tries++) {
      if (proc.exitCode !== null || tries === 200) throw new Error(`no server at ${url} (exit ${proc.exitCode})`);
      try {
        await Bun.fetch(url);
        break;
      } catch {
        await Bun.sleep(25);
      }
    }
    return await use(url);
  } finally {
    proc.kill();
    await proc.exited;
  }
}

const text = async (url: string | URL) => (await Bun.fetch(url)).text();

test("the README's server has HMR in development and none in production", async () => {
  // Bun keeps development.hmr under NODE_ENV=production; only the server's own gate drops it.
  const serve = (NODE_ENV: string) => withServer([process.execPath, "server.ts"], { NODE_ENV }, readmeDir, text);
  expect(await serve("development")).toContain("data-bun-dev-server-script");
  expect(await serve("production")).not.toContain("data-bun-dev-server-script");
});

test("bun build --compile makes the README's server one binary", async () => {
  const dir = mkdtempSync(`${tmpdir()}/railroad-compile-`);
  try {
    const built = Bun.spawnSync([process.execPath, "build", "--compile", "server.ts", "--outfile", `${dir}/app`], { cwd: readmeDir });
    expect(built.exitCode).toBe(0);
    // Run from elsewhere, so nothing comes from the source tree.
    const script = await withServer([`${dir}/app`], { NODE_ENV: "production" }, dir, async (url) => {
      const src = (await text(url)).match(/<script[^>]*src="([^"]+)"/)?.[1];
      expect(src).toBeDefined();
      return text(new URL(src!, url));
    });
    expect(script).toContain("Clicked");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("each module loads with no DOM, and signals run there", () => {
  // A child with no happy-dom: a server or a worker, as the README says.
  const script = `
    if (typeof document !== "undefined") throw new Error("a DOM is here");
    for (const path of ["", "/signals", "/routes", "/shared", "/logger"]) await import("@blueshed/railroad" + path);
    const { signal, computed, effect } = await import("@blueshed/railroad/signals");
    const n = signal(1);
    const doubled = computed(() => n.get() * 2);
    let seen = 0;
    effect(() => { seen = doubled.get(); });
    n.set(2);
    console.log("seen", seen);`;
  const run = Bun.spawnSync([process.execPath, "-e", script], { cwd: here });
  expect(run.stderr.toString()).toBe("");
  expect(run.stdout.toString().trim()).toBe("seen 4");
});
