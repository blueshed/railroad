import { describe, test, expect, beforeEach, afterEach, spyOn } from "bun:test";
import { createLogger, setLogLevel, getLogLevel, loggedRequest } from "./logger";

describe("logger", () => {
  let logSpy: ReturnType<typeof spyOn>;
  let warnSpy: ReturnType<typeof spyOn>;
  let errorSpy: ReturnType<typeof spyOn>;

  beforeEach(() => {
    logSpy = spyOn(console, "log").mockImplementation(() => {});
    warnSpy = spyOn(console, "warn").mockImplementation(() => {});
    errorSpy = spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    logSpy.mockRestore();
    warnSpy.mockRestore();
    errorSpy.mockRestore();
    setLogLevel("info");
  });

  test("getLogLevel returns current level", () => {
    setLogLevel("debug");
    expect(getLogLevel()).toBe("debug");
    setLogLevel("warn");
    expect(getLogLevel()).toBe("warn");
  });

  test("info logs at info level", () => {
    setLogLevel("info");
    const log = createLogger("[test]");
    log.info("hello");
    expect(logSpy).toHaveBeenCalledTimes(1);
    expect(logSpy.mock.calls[0][0]).toContain("[test]");
    expect(logSpy.mock.calls[0][0]).toContain("hello");
  });

  test("debug logs at debug level", () => {
    setLogLevel("debug");
    const log = createLogger("[test]");
    log.debug("detail");
    expect(logSpy).toHaveBeenCalledTimes(1);
    expect(logSpy.mock.calls[0][0]).toContain("detail");
  });

  test("debug suppressed at info level", () => {
    setLogLevel("info");
    const log = createLogger("[test]");
    log.debug("hidden");
    expect(logSpy).not.toHaveBeenCalled();
  });

  test("warn logs at warn level", () => {
    setLogLevel("warn");
    const log = createLogger("[test]");
    log.warn("caution");
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy.mock.calls[0][0]).toContain("caution");
  });

  test("warn suppressed at error level", () => {
    setLogLevel("error");
    const log = createLogger("[test]");
    log.warn("hidden");
    expect(warnSpy).not.toHaveBeenCalled();
  });

  test("error logs at error level", () => {
    setLogLevel("error");
    const log = createLogger("[test]");
    log.error("fail");
    expect(errorSpy).toHaveBeenCalledTimes(1);
    expect(errorSpy.mock.calls[0][0]).toContain("fail");
  });

  test("silent suppresses everything", () => {
    setLogLevel("silent");
    const log = createLogger("[test]");
    log.debug("a");
    log.info("b");
    log.warn("c");
    log.error("d");
    expect(logSpy).not.toHaveBeenCalled();
    expect(warnSpy).not.toHaveBeenCalled();
    expect(errorSpy).not.toHaveBeenCalled();
  });

  test("output includes timestamp and level", () => {
    setLogLevel("info");
    const log = createLogger("[srv]");
    log.info("started");
    const output = logSpy.mock.calls[0][0];
    expect(output).toMatch(/\d{2}:\d{2}:\d{2}\.\d{3}/);
    expect(output).toContain("INFO");
    expect(output).toContain("[srv]");
  });
});

describe("loggedRequest", () => {
  let logSpy: ReturnType<typeof spyOn>;

  beforeEach(() => {
    setLogLevel("info");
    logSpy = spyOn(console, "log").mockImplementation(() => {});
  });

  afterEach(() => {
    logSpy.mockRestore();
    setLogLevel("info");
  });

  test("logs method, path, status, and timing", async () => {
    const handler = loggedRequest("[api]", () => new Response("ok", { status: 200 }));
    const res = await handler(new Request("http://localhost/hello"));
    expect(res.status).toBe(200);
    expect(logSpy).toHaveBeenCalledTimes(1);
    const output = logSpy.mock.calls[0][0];
    expect(output).toContain("GET");
    expect(output).toContain("/hello");
    expect(output).toContain("200");
    expect(output).toMatch(/\d+\.\d+ms/);
  });

  test("logs error and rethrows", async () => {
    const errorSpy = spyOn(console, "error").mockImplementation(() => {});
    const handler = loggedRequest("[api]", () => { throw new Error("boom"); });
    expect(handler(new Request("http://localhost/fail"))).rejects.toThrow("boom");
    await Bun.sleep(10);
    expect(errorSpy).toHaveBeenCalledTimes(1);
    const output = errorSpy.mock.calls[0][0];
    expect(output).toContain("boom");
    expect(output).toContain("/fail");
    errorSpy.mockRestore();
  });
});
