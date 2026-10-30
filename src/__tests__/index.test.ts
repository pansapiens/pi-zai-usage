import { describe, it, expect, vi, beforeEach } from "vitest";

const mockSetStatus = vi.fn();
const mockGetApiKey = vi.fn();
const mockFetchZaiUsage = vi.fn();
const mockCacheGet = vi.fn();
const mockCacheSet = vi.fn();
const mockCacheClear = vi.fn();

vi.mock("../api.js", async () => {
  // eslint-disable-next-line @typescript-eslint/consistent-type-imports
  const actual = await vi.importActual<typeof import("../api.js")>("../api.js");
  return {
    ...actual,
    fetchZaiUsage: (...args: unknown[]) => mockFetchZaiUsage(...args),
  };
});

vi.mock("../usage-cache.js", () => ({
  UsageCache: vi.fn().mockImplementation(function () {
    return {
      get: (...args: unknown[]) => mockCacheGet(...args),
      set: (...args: unknown[]) => mockCacheSet(...args),
      clear: (...args: unknown[]) => mockCacheClear(...args),
    };
  }),
}));

vi.mock("@earendil-works/pi-coding-agent", () => ({}));

const zaiCtx = {
  hasUI: true,
  ui: { setStatus: mockSetStatus },
  model: { provider: "zai", id: "glm-5.1" },
  modelRegistry: {
    getApiKeyForProvider: mockGetApiKey,
    getAll: () => [] as { provider: string }[],
  },
};
const openaiCtx = { ...zaiCtx, model: { provider: "openai", id: "gpt-4" } };

const sampleUsageData = { percentage: 42.5, resetTimeMs: 1700000000000 };

type Tool = { execute: (...args: unknown[]) => Promise<{ content: { text: string }[] }> };

async function load() {
  const handlers: Record<string, (...args: unknown[]) => unknown> = {};
  const tools: Record<string, Tool> = {};
  const mockPi = {
    on: (event: string, handler: (...args: unknown[]) => unknown) => {
      handlers[event] = handler;
    },
    registerTool: (tool: Tool & { name: string }) => {
      tools[tool.name] = tool;
    },
    registerCommand: () => {},
  };
  const { default: initExtension } = await import("../index.js");
  initExtension(mockPi as never);
  return { handlers, tools };
}

describe("extension entry point", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    mockCacheGet.mockReturnValue(null);
    mockGetApiKey.mockImplementation(async (p: string) => (p === "zai" ? "test-key" : undefined));
    mockFetchZaiUsage.mockResolvedValue(sampleUsageData);
  });

  it("publishes status on session_start with a Z.ai model", async () => {
    const { handlers } = await load();
    await handlers["session_start"]!(undefined, zaiCtx);
    expect(mockFetchZaiUsage).toHaveBeenCalledWith("test-key");
    expect(mockCacheSet).toHaveBeenCalledWith(sampleUsageData);
    expect(mockSetStatus).toHaveBeenCalledWith("zai-usage", expect.stringContaining("Z.AI: 42.5%"));
  });

  it("publishes status even when a non-Z.ai model is active", async () => {
    const { handlers } = await load();
    await handlers["turn_end"]!(undefined, openaiCtx);
    expect(mockGetApiKey).toHaveBeenCalledWith("zai");
    expect(mockFetchZaiUsage).toHaveBeenCalledWith("test-key");
    expect(mockSetStatus).toHaveBeenCalledWith("zai-usage", expect.stringContaining("Z.AI: 42.5%"));
  });

  it("finds a key on another Z.ai-named provider from the registry", async () => {
    const { handlers } = await load();
    mockGetApiKey.mockImplementation(async (p: string) => (p === "z-ai" ? "other-key" : undefined));
    const ctx = {
      ...openaiCtx,
      modelRegistry: {
        ...openaiCtx.modelRegistry,
        getAll: () => [{ provider: "openai" }, { provider: "z-ai" }],
      },
    };
    await handlers["session_start"]!(undefined, ctx);
    expect(mockFetchZaiUsage).toHaveBeenCalledWith("other-key");
  });

  it("clears status when no Z.ai key is configured", async () => {
    const { handlers } = await load();
    mockGetApiKey.mockResolvedValue(undefined);
    await handlers["session_start"]!(undefined, zaiCtx);
    expect(mockFetchZaiUsage).not.toHaveBeenCalled();
    expect(mockSetStatus).toHaveBeenCalledWith("zai-usage", undefined);
  });

  it("uses cached data without fetching", async () => {
    const { handlers } = await load();
    mockCacheGet.mockReturnValue(sampleUsageData);
    await handlers["turn_end"]!(undefined, zaiCtx);
    expect(mockFetchZaiUsage).not.toHaveBeenCalled();
    expect(mockSetStatus).toHaveBeenCalledWith("zai-usage", expect.stringContaining("42.5%"));
  });

  it("does nothing without a UI", async () => {
    const { handlers } = await load();
    await handlers["session_start"]!(undefined, { ...zaiCtx, hasUI: false });
    expect(mockFetchZaiUsage).not.toHaveBeenCalled();
    expect(mockSetStatus).not.toHaveBeenCalled();
  });

  it("shows an error status when the fetch fails", async () => {
    const { handlers } = await load();
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    mockFetchZaiUsage.mockRejectedValue(new Error("network failure"));
    await handlers["session_start"]!(undefined, zaiCtx);
    expect(mockSetStatus).toHaveBeenCalledWith("zai-usage", "Z.AI: error");
    spy.mockRestore();
  });

  it("coalesces concurrent refreshes into one fetch", async () => {
    const { handlers } = await load();
    mockFetchZaiUsage.mockImplementation(
      () =>
        new Promise((r) => {
          setTimeout(() => {
            r(sampleUsageData);
          }, 10);
        }),
    );
    await Promise.all([
      handlers["session_start"]!(undefined, zaiCtx),
      handlers["turn_end"]!(undefined, zaiCtx),
    ]);
    expect(mockFetchZaiUsage).toHaveBeenCalledTimes(1);
  });

  it("clears status on session_shutdown", async () => {
    const { handlers } = await load();
    handlers["session_shutdown"]!(undefined, zaiCtx);
    expect(mockSetStatus).toHaveBeenCalledWith("zai-usage", undefined);
  });

  describe("zai_usage tool", () => {
    it("reports usage while a non-Z.ai model is active, without a UI", async () => {
      const { tools } = await load();
      const res = await tools["zai_usage"]!.execute("id", {}, undefined, undefined, {
        ...openaiCtx,
        hasUI: false,
      });
      expect(res.content[0]!.text).toMatch(/^Z\.AI token quota: 42\.5% used/);
    });

    it("bypasses the cache when refresh is set", async () => {
      const { tools } = await load();
      await tools["zai_usage"]!.execute("id", { refresh: true }, undefined, undefined, zaiCtx);
      expect(mockCacheClear).toHaveBeenCalled();
    });

    it("reports a missing key", async () => {
      const { tools } = await load();
      mockGetApiKey.mockResolvedValue(undefined);
      const res = await tools["zai_usage"]!.execute("id", {}, undefined, undefined, openaiCtx);
      expect(res.content[0]!.text).toMatch(/No Z\.AI API key/);
    });
  });
});
