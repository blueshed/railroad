import { describe, test, expect, afterEach } from "bun:test";
import { key, provide, inject, tryInject, clearProviders } from "./shared";

describe("shared", () => {
  test("provide and inject", () => {
    const K = key<string>("name");
    provide(K, "alice");
    expect(inject(K)).toBe("alice");
  });

  test("inject throws when no provider", () => {
    const K = key<number>("missing");
    expect(() => inject(K)).toThrow("No provider for missing");
  });

  test("tryInject returns undefined when no provider", () => {
    const K = key<number>("absent");
    expect(tryInject(K)).toBeUndefined();
  });

  test("tryInject returns value when provided", () => {
    const K = key<number>("count");
    provide(K, 42);
    expect(tryInject(K)).toBe(42);
  });

  test("keys with same name are distinct", () => {
    const K1 = key<string>("dup");
    const K2 = key<string>("dup");
    provide(K1, "first");
    provide(K2, "second");
    expect(inject(K1)).toBe("first");
    expect(inject(K2)).toBe("second");
  });

  test("provide overwrites previous value", () => {
    const K = key<string>("overwrite");
    provide(K, "old");
    provide(K, "new");
    expect(inject(K)).toBe("new");
  });
});

describe("provide(undefined) and clearProviders()", () => {
  afterEach(() => clearProviders());
  test("provide(undefined) is honored — inject does not throw", () => {
    const K = key<number | undefined>("opt");
    provide(K, undefined);
    expect(() => inject(K)).not.toThrow();
    expect(inject(K)).toBeUndefined();
  });

  test("clearProviders resets the registry", () => {
    const K = key<string>("x");
    provide(K, "v");
    expect(inject(K)).toBe("v");
    clearProviders();
    expect(() => inject(K)).toThrow(/No provider/);
  });
});
