import { describe, expect, it } from "vitest";
import { defaultPathConfig, normalizeStorageConfig } from "./shared";

describe("normalizeStorageConfig", () => {
  it("does not create archive targets by default", () => {
    const normalized = normalizeStorageConfig();

    expect(normalized.targets).toEqual({});
    expect(normalized.default_targets).toEqual([]);
    expect(normalized.fallback_targets).toEqual([]);
    expect(normalized.fallback_policy).toBe("on_failure");
  });

  it("infers netdisk auth modes from saved credential fields", () => {
    const normalized = normalizeStorageConfig({
      targets: {
        baidu: {
          type: "baidu_netdisk",
          app_key: "",
          app_name: "gpt-image-2",
          access_token: { source: "file", present: true },
        },
        pan123: {
          type: "pan123_open",
          client_id: "",
          access_token: { source: "env", env: "PAN123_TOKEN" },
          parent_id: 0,
          use_direct_link: false,
        },
      },
    });

    expect(normalized.targets.baidu).toMatchObject({
      type: "baidu_netdisk",
      auth_mode: "personal",
    });
    expect(normalized.targets.pan123).toMatchObject({
      type: "pan123_open",
      auth_mode: "access_token",
    });
  });
});

describe("defaultPathConfig", () => {
  it("exports to the result library by default", () => {
    expect(defaultPathConfig().default_export_dir).toEqual({
      mode: "result_library",
      path: null,
    });
  });
});
