import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ensureSystemNotificationPermission,
  sendSystemNotification,
} from "./system-notifications";

describe("system notifications", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("requests browser permission before sending a browser notification", async () => {
    const requestPermission = vi.fn().mockResolvedValue("granted");
    const notification = vi.fn();
    Object.assign(notification, {
      permission: "default",
      requestPermission,
    });
    vi.stubGlobal("window", {
      Notification: notification,
    });

    await expect(
      ensureSystemNotificationPermission(),
    ).resolves.toMatchObject({
      ok: true,
      channel: "browser",
    });
    expect(requestPermission).toHaveBeenCalledOnce();

    await expect(
      sendSystemNotification("测试通知", "权限已开启"),
    ).resolves.toMatchObject({
      ok: true,
      channel: "browser",
    });
    expect(notification).toHaveBeenCalledWith("测试通知", {
      body: "权限已开启",
    });
  });

  it("reports unsupported environments without throwing", async () => {
    vi.stubGlobal("window", {});

    await expect(
      sendSystemNotification("测试通知", "当前环境"),
    ).resolves.toMatchObject({
      ok: false,
      reason: "unsupported",
    });
  });
});
