import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../config/loader.js", () => ({
  loadConfig: vi.fn(),
  defaultConfig: vi.fn(),
}));

import { PermissionManager } from "./manager.js";
import { loadConfig, defaultConfig } from "../config/loader.js";
import type { ServerConfig } from "../config/schema.js";

const mockedLoadConfig = vi.mocked(loadConfig);
const mockedDefaultConfig = vi.mocked(defaultConfig);

function makeConfig(
  toolOverrides: Record<string, { enabled: boolean; rateLimit: number | null }>
): ServerConfig {
  return {
    configVersion: 1,
    connection: {
      smtpHost: "localhost",
      smtpPort: 1025,
      imapHost: "localhost",
      imapPort: 1143,
      username: "",
      password: "",
      smtpToken: "",
      bridgeCertPath: "",
      debug: false,
    },
    permissions: {
      preset: "custom",
      tools: toolOverrides as ServerConfig["permissions"]["tools"],
    },
  };
}

describe("PermissionManager", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.useFakeTimers();
  });

  it("returns allowed: false with a reason for a disabled tool", () => {
    const config = makeConfig({
      send_email: { enabled: false, rateLimit: null },
    });
    mockedLoadConfig.mockReturnValue(config);

    const manager = new PermissionManager();
    const result = manager.check("send_email");

    expect(result.allowed).toBe(false);
    expect(result.reason).toContain("send_email");
    expect(result.reason).toContain("disabled");
  });

  it("returns allowed: true for an enabled tool with no rate limit", () => {
    const config = makeConfig({
      get_emails: { enabled: true, rateLimit: null },
    });
    mockedLoadConfig.mockReturnValue(config);

    const manager = new PermissionManager();
    const result = manager.check("get_emails");

    expect(result.allowed).toBe(true);
    expect(result.reason).toBeUndefined();
  });

  it("enforces rate limit after N calls within the rolling window", () => {
    const config = makeConfig({
      delete_email: { enabled: true, rateLimit: 2 },
    });
    mockedLoadConfig.mockReturnValue(config);

    const manager = new PermissionManager();

    // First two calls should succeed
    expect(manager.check("delete_email")).toEqual({ allowed: true });
    expect(manager.check("delete_email")).toEqual({ allowed: true });

    // Third call within the same window should be denied
    const denied = manager.check("delete_email");
    expect(denied.allowed).toBe(false);
    expect(denied.reason).toContain("rate limit");
    expect(denied.reason).toContain("2");
  });

  it("resets the rate limit after the 1-hour rolling window elapses", () => {
    const config = makeConfig({
      delete_email: { enabled: true, rateLimit: 2 },
    });
    mockedLoadConfig.mockReturnValue(config);

    const manager = new PermissionManager();

    expect(manager.check("delete_email").allowed).toBe(true);
    expect(manager.check("delete_email").allowed).toBe(true);
    expect(manager.check("delete_email").allowed).toBe(false);

    // Advance past the 1-hour window
    vi.advanceTimersByTime(60 * 60 * 1000 + 1);

    // Should be allowed again
    expect(manager.check("delete_email").allowed).toBe(true);
  });

  it("allows unlimited calls when rateLimit is null", () => {
    const config = makeConfig({
      get_emails: { enabled: true, rateLimit: null },
    });
    mockedLoadConfig.mockReturnValue(config);

    const manager = new PermissionManager();

    for (let i = 0; i < 100; i++) {
      expect(manager.check("get_emails").allowed).toBe(true);
    }
  });

  it("falls back to defaultConfig when loadConfig returns null", () => {
    mockedLoadConfig.mockReturnValue(null);
    mockedDefaultConfig.mockReturnValue(
      makeConfig({
        send_email: { enabled: false, rateLimit: null },
      })
    );

    const manager = new PermissionManager();
    const result = manager.check("send_email");

    expect(result.allowed).toBe(false);
    expect(mockedDefaultConfig).toHaveBeenCalled();
  });

  it("allows a tool that has no explicit permission entry in config", () => {
    // Config with no tool entries at all
    const config = makeConfig({});
    mockedLoadConfig.mockReturnValue(config);

    const manager = new PermissionManager();
    const result = manager.check("get_emails");

    expect(result.allowed).toBe(true);
  });

  it("reloads config after the cache TTL expires", () => {
    const config1 = makeConfig({
      send_email: { enabled: true, rateLimit: null },
    });
    const config2 = makeConfig({
      send_email: { enabled: false, rateLimit: null },
    });
    mockedLoadConfig.mockReturnValue(config1);

    const manager = new PermissionManager();
    expect(manager.check("send_email").allowed).toBe(true);

    // Update the mock and advance past the 15s cache TTL
    mockedLoadConfig.mockReturnValue(config2);
    vi.advanceTimersByTime(15_001);

    expect(manager.check("send_email").allowed).toBe(false);
  });

  it("invalidate() forces an immediate config reload", () => {
    const config1 = makeConfig({
      send_email: { enabled: true, rateLimit: null },
    });
    const config2 = makeConfig({
      send_email: { enabled: false, rateLimit: null },
    });
    mockedLoadConfig.mockReturnValue(config1);

    const manager = new PermissionManager();
    expect(manager.check("send_email").allowed).toBe(true);

    mockedLoadConfig.mockReturnValue(config2);
    manager.invalidate();

    expect(manager.check("send_email").allowed).toBe(false);
  });
});
