import { describe, it, expect, vi, beforeEach } from "vitest";

const mockSetStatus = vi.fn();
const mockGetApiKey = vi.fn();
const mockFetchZaiUsage = vi.fn();
const mockCacheGet = vi.fn();
const mockCacheSet = vi.fn();
const mockCacheClear = vi.fn();

vi.mock("../api.js", () => ({
  isZaiProvider: (p: string | undefined) =>
    p?.toLowerCase().startsWith("zai") ?? false,
  fetchZaiUsage: (...args: unknown[]) => mockFetchZaiUsage(...args),
}));

vi.mock("../usage-cache.js", () => ({
  UsageCache: vi.fn().mockImplementation(() => ({
    get: (...args: unknown[]) => mockCacheGet(...args),
    set: (...args: unknown[]) => mockCacheSet(...args),
    clear: (...args: unknown[]) => mockCacheClear(...args),
  })),
}));

vi.mock("@earendil-works/pi-coding-agent", () => ({}));

const mockCtx = {
  hasUI: true,
  ui: { setStatus: mockSetStatus },
  model: { provider: "zai", id: "glm-5.1" },
  modelRegistry: { getApiKeyForProvider: mockGetApiKey },
};

const sampleUsageData = { percentage: 42.5, resetTimeMs: 1700000000000 };

async function getHandlers() {
  const handlers: Record<string, (...args: unknown[]) => unknown> = {};
  const mockPi = {
    on: (event: string, handler: (...args: unknown[]) => unknown) => {
      handlers[event] = handler;
    },
  };

  const { default: initExtension } = await import("../index.js");
  initExtension(mockPi as never);
  return handlers;
}

describe("extension entry point", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCacheGet.mockReturnValue(null);
    mockGetApiKey.mockResolvedValue("test-key");
    mockFetchZaiUsage.mockResolvedValue(sampleUsageData);
  });

  // ── session_start ──────────────────────────────────────────────────

  describe("session_start handler", () => {
    it("fetches usage, caches, and publishes status when ZAI model + hasUI + API key", async () => {
      const handlers = await getHandlers();

      await handlers["session_start"](undefined, mockCtx);

      expect(mockFetchZaiUsage).toHaveBeenCalledWith("test-key");
      expect(mockCacheSet).toHaveBeenCalledWith(sampleUsageData);
      expect(mockSetStatus).toHaveBeenCalledWith(
        "zai-usage",
        expect.any(String),
      );

      const payload = JSON.parse(mockSetStatus.mock.calls[0][1]);
      expect(payload).toEqual({
        percentage: sampleUsageData.percentage,
        resetTimeMs: sampleUsageData.resetTimeMs,
      });
    });

    it("silently skips when ZAI model + hasUI but no API key", async () => {
      const handlers = await getHandlers();
      mockGetApiKey.mockResolvedValue(undefined);

      await handlers["session_start"](undefined, mockCtx);

      expect(mockFetchZaiUsage).not.toHaveBeenCalled();
      expect(mockSetStatus).not.toHaveBeenCalled();
    });

    it("clears status when non-ZAI model", async () => {
      const handlers = await getHandlers();
      const ctx = { ...mockCtx, model: { provider: "openai", id: "gpt-4" } };

      await handlers["session_start"](undefined, ctx);

      expect(mockSetStatus).toHaveBeenCalledWith("zai-usage", undefined);
      expect(mockFetchZaiUsage).not.toHaveBeenCalled();
    });

    it("does not call setStatus when hasUI is false", async () => {
      const handlers = await getHandlers();
      const ctx = { ...mockCtx, hasUI: false };

      await handlers["session_start"](undefined, ctx);

      expect(mockSetStatus).not.toHaveBeenCalled();
    });

    it("logs error and does not crash when fetchZaiUsage throws", async () => {
      const handlers = await getHandlers();
      const consoleSpy = vi
        .spyOn(console, "error")
        .mockImplementation(() => {});
      mockFetchZaiUsage.mockRejectedValue(new Error("network failure"));

      await handlers["session_start"](undefined, mockCtx);

      expect(consoleSpy).toHaveBeenCalledWith(
        "[pi-zai-usage]",
        expect.any(Error),
      );
      expect(mockSetStatus).not.toHaveBeenCalled();

      consoleSpy.mockRestore();
    });
  });

  // ── model_select ───────────────────────────────────────────────────

  describe("model_select handler", () => {
    it("clears cache and fetches fresh data when switching to ZAI", async () => {
      const handlers = await getHandlers();

      await handlers["model_select"](undefined, mockCtx);

      expect(mockCacheClear).toHaveBeenCalled();
      expect(mockFetchZaiUsage).toHaveBeenCalledWith("test-key");
      expect(mockCacheSet).toHaveBeenCalledWith(sampleUsageData);
      expect(mockSetStatus).toHaveBeenCalledWith(
        "zai-usage",
        expect.any(String),
      );
    });

    it("clears status when switching away from ZAI", async () => {
      const handlers = await getHandlers();
      const ctx = { ...mockCtx, model: { provider: "openai", id: "gpt-4" } };

      await handlers["model_select"](undefined, ctx);

      expect(mockCacheClear).toHaveBeenCalled();
      expect(mockSetStatus).toHaveBeenCalledWith("zai-usage", undefined);
      expect(mockFetchZaiUsage).not.toHaveBeenCalled();
    });
  });

  // ── turn_end ───────────────────────────────────────────────────────

  describe("turn_end handler", () => {
    it("uses cached data when cache is fresh and skips fetch", async () => {
      const handlers = await getHandlers();
      mockCacheGet.mockReturnValue(sampleUsageData);

      await handlers["turn_end"](undefined, mockCtx);

      expect(mockFetchZaiUsage).not.toHaveBeenCalled();
      expect(mockSetStatus).toHaveBeenCalledWith(
        "zai-usage",
        expect.any(String),
      );

      const payload = JSON.parse(mockSetStatus.mock.calls[0][1]);
      expect(payload).toEqual({
        percentage: sampleUsageData.percentage,
        resetTimeMs: sampleUsageData.resetTimeMs,
      });
    });

    it("fetches fresh data when cache is expired", async () => {
      const handlers = await getHandlers();
      mockCacheGet.mockReturnValue(null);

      await handlers["turn_end"](undefined, mockCtx);

      expect(mockFetchZaiUsage).toHaveBeenCalledWith("test-key");
      expect(mockCacheSet).toHaveBeenCalledWith(sampleUsageData);
    });

    it("clears status when non-ZAI model", async () => {
      const handlers = await getHandlers();
      const ctx = { ...mockCtx, model: { provider: "openai", id: "gpt-4" } };

      await handlers["turn_end"](undefined, ctx);

      expect(mockSetStatus).toHaveBeenCalledWith("zai-usage", undefined);
      expect(mockFetchZaiUsage).not.toHaveBeenCalled();
    });
  });

  // ── session_shutdown ───────────────────────────────────────────────

  describe("session_shutdown handler", () => {
    it("clears status via setStatus with undefined", async () => {
      const handlers = await getHandlers();

      handlers["session_shutdown"](undefined, mockCtx);

      expect(mockSetStatus).toHaveBeenCalledWith("zai-usage", undefined);
    });

    it("does not call setStatus when hasUI is false", async () => {
      const handlers = await getHandlers();
      const ctx = { ...mockCtx, hasUI: false };

      handlers["session_shutdown"](undefined, ctx);

      expect(mockSetStatus).not.toHaveBeenCalled();
    });
  });
});
