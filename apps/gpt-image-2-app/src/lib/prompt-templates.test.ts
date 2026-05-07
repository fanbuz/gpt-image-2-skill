import { afterEach, describe, expect, it, vi } from "vitest";
import {
  defaultPromptTemplateState,
  importPromptTemplates,
  insertPromptAtCursor,
  loadPromptTemplates,
  savePromptTemplates,
  visiblePromptTemplatesForScope,
} from "./prompt-templates";

function installStorage() {
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
    dispatchEvent: vi.fn(),
  });
}

describe("prompt templates", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("seeds editable sample templates by default", () => {
    installStorage();

    const state = loadPromptTemplates();

    expect(state.groups[0]?.name).toBe("示例");
    expect(state.templates.length).toBeGreaterThan(0);
  });

  it("persists empty user state after deleting samples", () => {
    installStorage();

    savePromptTemplates({ version: 1, groups: [], templates: [] });

    expect(loadPromptTemplates()).toEqual({
      version: 1,
      groups: [],
      templates: [],
    });
  });

  it("filters common and target-specific templates", () => {
    const state = defaultPromptTemplateState();

    const generate = visiblePromptTemplatesForScope(state, "generate");
    const region = visiblePromptTemplatesForScope(state, "region");

    expect(generate.some((template) => template.scope === "generate")).toBe(
      true,
    );
    expect(generate.some((template) => template.scope === "region")).toBe(
      false,
    );
    expect(region.some((template) => template.scope === "common")).toBe(true);
    expect(region.some((template) => template.scope === "region")).toBe(true);
  });

  it("inserts prompt text at the current selection", () => {
    expect(insertPromptAtCursor("hello world", "beautiful ", 6, 6)).toEqual({
      value: "hello beautiful world",
      cursor: 16,
    });
    expect(insertPromptAtCursor("hello world", "image", 6, 11)).toEqual({
      value: "hello image",
      cursor: 11,
    });
  });

  it("normalizes imported json", () => {
    const state = importPromptTemplates(
      JSON.stringify({
        version: 1,
        groups: [{ id: "g", name: "Mine" }],
        templates: [{ id: "t", groupId: "g", title: "A", prompt: "B" }],
      }),
    );

    expect(state.templates[0]).toMatchObject({
      id: "t",
      groupId: "g",
      scope: "common",
    });
  });
});
