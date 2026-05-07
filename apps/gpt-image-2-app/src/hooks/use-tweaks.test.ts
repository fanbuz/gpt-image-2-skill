import { afterEach, describe, expect, it, vi } from "vitest";
import {
  __loadTweaksForTests,
  __resolveInitialInterfaceModeForTests,
} from "./use-tweaks";

function installWindow(overrides: Record<string, unknown> = {}) {
  const storage = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: vi.fn((key: string) => storage.get(key) ?? null),
    setItem: vi.fn((key: string, value: string) => {
      storage.set(key, value);
    }),
    removeItem: vi.fn((key: string) => {
      storage.delete(key);
    }),
    clear: vi.fn(() => storage.clear()),
  });
  vi.stubGlobal("window", {
    ...overrides,
  });
}

describe("initial interface mode migration", () => {
  afterEach(() => {
    globalThis.localStorage?.clear();
    vi.unstubAllGlobals();
  });

  it("keeps first-time users on the modern interface", () => {
    installWindow();

    expect(__resolveInitialInterfaceModeForTests(undefined)).toBe("modern");
  });

  it("moves older static page users to the classic interface", () => {
    installWindow();

    expect(__resolveInitialInterfaceModeForTests({ theme: "dark" })).toBe(
      "legacy",
    );
  });

  it("preserves explicit modern choices", () => {
    installWindow();

    expect(
      __resolveInitialInterfaceModeForTests({
        theme: "dark",
        interfaceMode: "modern",
      }),
    ).toBe("modern");
  });

  it("does not migrate the Tauri app", () => {
    installWindow({ __TAURI_INTERNALS__: {} });

    expect(__resolveInitialInterfaceModeForTests({ theme: "dark" })).toBe(
      "modern",
    );
  });

  it("does not migrate the HTTP web runtime", () => {
    installWindow({ __GPT_IMAGE_2_RUNTIME__: "http" });

    expect(__resolveInitialInterfaceModeForTests({ theme: "dark" })).toBe(
      "modern",
    );
  });

  it("enables creative draft persistence by default", () => {
    installWindow();

    expect(__loadTweaksForTests().persistCreativeDrafts).toBe(true);
  });

  it("preserves an explicit creative draft persistence opt-out", () => {
    installWindow();
    localStorage.setItem(
      "gpt2.tweaks",
      JSON.stringify({ persistCreativeDrafts: false }),
    );

    expect(__loadTweaksForTests().persistCreativeDrafts).toBe(false);
  });
});
