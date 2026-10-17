import { afterEach, describe, expect, it, vi } from "vitest";
import { checkBackendReachable } from "../src/auth/client";
import { validateConfig } from "../src/config";

afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

describe("Desktop connection and public credentials", () => {
  it("checks Auth rather than treating the gateway page as a working login", async () => {
    const request = vi.fn().mockResolvedValue(new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", request);
    await expect(checkBackendReachable("http://127.0.0.1:8700/")).resolves.toEqual({ ok: true });
    expect(request).toHaveBeenCalledWith("http://127.0.0.1:8700/auth/v1/health", expect.objectContaining({ signal: expect.any(AbortSignal) }));
  });

  it("provides a concrete tunnel recovery message without exposing configuration keys", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("offline")));
    const result = await checkBackendReachable("http://127.0.0.1:8700");
    expect(result).toMatchObject({ ok: false, reason: expect.stringContaining("SSH-tunnel") });
  });

  it("does not report non-200 Auth as a working connection", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("", { status: 503 })));
    await expect(checkBackendReachable("https://backend.example.test")).resolves.toEqual({ ok: false, reason: "Backenden svarade med status 503." });
  });

  it("bounds every check, including callers that provide no AbortSignal", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("fetch", vi.fn((_url, init: RequestInit) => new Promise((_resolve, reject) => {
      init.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
    })));
    const pending = checkBackendReachable("http://127.0.0.1:8700");
    await vi.advanceTimersByTimeAsync(8000);
    await expect(pending).resolves.toEqual({ ok: false, reason: "Anslutningen tog för lång tid." });
    expect(vi.getTimerCount()).toBe(0);
  });

  it("honors caller cancellation and clears the timeout", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("fetch", vi.fn((_url, init: RequestInit) => new Promise((_resolve, reject) => {
      init.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
    })));
    const controller = new AbortController();
    const pending = checkBackendReachable("https://backend.example.test", controller.signal);
    controller.abort();
    expect((await pending).ok).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("handles invalid URLs without rejecting the recovery flow", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("invalid URL")));
    await expect(checkBackendReachable("invalid")).resolves.toMatchObject({ ok: false });
  });

  it("rejects both legacy service-role JWTs and new secret API keys", () => {
    const jwt = `header.${btoa(JSON.stringify({ role: "service_role" }))}.signature`;
    for (const anonKey of [jwt, "sb_secret_synthetic_test_only"]) {
      expect(() => validateConfig({ backendUrl: "https://backend.example.test", anonKey })).toThrow("administrativ");
    }
    expect(validateConfig({ backendUrl: "https://backend.example.test", anonKey: "sb_publishable_synthetic_test_only" }).anonKey).toContain("sb_publishable_");
  });
});
