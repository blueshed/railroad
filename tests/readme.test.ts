// What README.md and the skills promise about serving and building, run as written.
// Each runs in a child process: these are real servers, and happy-dom (preloaded here)
// replaces fetch and Response, so pages are fetched with Bun.fetch.

import { test, expect, setDefaultTimeout } from "bun:test";

setDefaultTimeout(30_000);

const here = import.meta.dir;

// Starts `cmd`, which prints "Listening on <url>", and returns the process and that URL.
async function listen(cmd: string[], env: Record<string, string> = {}, cwd = here) {
  const proc = Bun.spawn(cmd, { cwd, env: { ...process.env, PORT: "0", ...env }, stdout: "pipe" });
  const reader = proc.stdout.getReader();
  let out = "";
  while (true) {
    const { value, done } = await reader.read();
    if (done) throw new Error(`exited without listening:\n${out}`);
    out += new TextDecoder().decode(value);
    const url = out.match(/Listening on (\S+)/)?.[1];
    if (url) {
      reader.releaseLock();
      return { proc, url };
    }
  }
}

async function page(cmd: string[], env: Record<string, string> = {}): Promise<string> {
  const { proc, url } = await listen(cmd, env);
  try {
    return await (await Bun.fetch(url)).text();
  } finally {
    proc.kill();
    await proc.exited;
  }
}

test("the README's server has HMR in development and none in production", async () => {
  // Bun keeps development.hmr under NODE_ENV=production; only the server's own gate drops it.
  const serve = [process.execPath, "fixtures/serve.ts"];
  expect(await page(serve, { NODE_ENV: "development" })).toContain("data-bun-dev-server-script");
  expect(await page(serve, { NODE_ENV: "production" })).not.toContain("data-bun-dev-server-script");
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

test("the README's Try it files are tests/fixtures/readme, as written", async () => {
  // tests/webview.test.ts runs that fixture in a browser, so this keeps the two the same.
  const readme = await Bun.file(`${here}/../README.md`).text();
  for (const [name, lang] of [["tsconfig.json", "json"], ["index.html", "html"], ["app.tsx", "tsx"]] as const) {
    const block = readme.match(new RegExp("```" + lang + "\\n[^\\n]*" + name.replace(".", "\\.") + "[^\\n]*\\n([\\s\\S]*?)```"));
    expect(await Bun.file(`${here}/fixtures/readme/${name}`).text()).toBe(block![1]!);
  }
});

test("bun build --compile makes the README's server one binary", async () => {
  const { mkdtempSync, rmSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const dir = mkdtempSync(`${tmpdir()}/railroad-compile-`);
  try {
    const built = Bun.spawnSync([process.execPath, "build", "--compile", "fixtures/serve.ts", "--outfile", `${dir}/app`], { cwd: here });
    expect(built.exitCode).toBe(0);
    // Run from elsewhere, so nothing comes from the source tree.
    const { proc, url } = await listen([`${dir}/app`], { NODE_ENV: "production" }, dir);
    try {
      const html = await (await Bun.fetch(url)).text();
      const script = html.match(/<script[^>]*src="([^"]+)"/)?.[1];
      expect(script).toBeDefined();
      expect(await (await Bun.fetch(new URL(script!, url))).text()).toContain("data-route");
    } finally {
      proc.kill();
      await proc.exited;
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
