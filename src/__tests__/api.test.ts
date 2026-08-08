import { describe, it, expect, vi, beforeEach } from "vitest";
import { isZaiProvider, fetchZaiUsage } from "../api.js";

function mockFetchResponse(
  data: unknown,
  ok = true,
  status = 200,
  contentEncoding: string | null = null,
): Response {
  return {
    ok,
    status,
    headers: {
      get: (name: string) => (name.toLowerCase() === "content-encoding" ? contentEncoding : null),
    },
    json: vi.fn().mockResolvedValue(data),
  } as unknown as Response;
}

describe("isZaiProvider", () => {
  it('returns true for "zai"', () => {
    expect(isZaiProvider("zai")).toBe(true);
  });

  it('returns true for "ZAI" (case insensitive)', () => {
    expect(isZaiProvider("ZAI")).toBe(true);
  });

  it('returns true for "zai-pro" and "zai-extra" (prefix match)', () => {
    expect(isZaiProvider("zai-pro")).toBe(true);
    expect(isZaiProvider("zai-extra")).toBe(true);
  });

  it('returns false for "openai" and "anthropic"', () => {
    expect(isZaiProvider("openai")).toBe(false);
    expect(isZaiProvider("anthropic")).toBe(false);
  });

  it("returns false for undefined", () => {
    expect(isZaiProvider(undefined)).toBe(false);
  });

  it("returns false for empty string", () => {
    expect(isZaiProvider("")).toBe(false);
  });
});

describe("fetchZaiUsage", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("returns percentage rounded to 1 decimal and resetTimeMs on happy path", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      mockFetchResponse({
        success: true,
        data: {
          limits: [
            {
              type: "TOKENS_LIMIT",
              percentage: 45.67,
              nextResetTime: 1700000000000,
            },
          ],
        },
      }),
    );

    const result = await fetchZaiUsage("test-key");

    expect(result).toEqual({
      percentage: 45.7,
      resetTimeMs: 1700000000000,
    });
  });

  it("returns resetTimeMs as undefined when nextResetTime is absent", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      mockFetchResponse({
        success: true,
        data: {
          limits: [
            {
              type: "TOKENS_LIMIT",
              percentage: 45.67,
            },
          ],
        },
      }),
    );

    const result = await fetchZaiUsage("test-key");

    expect(result).toEqual({
      percentage: 45.7,
      resetTimeMs: undefined,
    });
  });

  it("rounds 45.672 to 45.7", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      mockFetchResponse({
        success: true,
        data: {
          limits: [{ type: "TOKENS_LIMIT", percentage: 45.672 }],
        },
      }),
    );

    const result = await fetchZaiUsage("test-key");
    expect(result.percentage).toBe(45.7);
  });

  it("rounds 100.0 to 100.0", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      mockFetchResponse({
        success: true,
        data: {
          limits: [{ type: "TOKENS_LIMIT", percentage: 100.0 }],
        },
      }),
    );

    const result = await fetchZaiUsage("test-key");
    expect(result.percentage).toBe(100.0);
  });

  it("rounds 0.05 to 0.1", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      mockFetchResponse({
        success: true,
        data: {
          limits: [{ type: "TOKENS_LIMIT", percentage: 0.05 }],
        },
      }),
    );

    const result = await fetchZaiUsage("test-key");
    expect(result.percentage).toBe(0.1);
  });

  it("clamps negative percentage to 0", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      mockFetchResponse({
        success: true,
        data: {
          limits: [{ type: "TOKENS_LIMIT", percentage: -5.0 }],
        },
      }),
    );

    const result = await fetchZaiUsage("test-key");
    expect(result.percentage).toBe(0);
  });

  it("clamps percentage above 100 to 100", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      mockFetchResponse({
        success: true,
        data: {
          limits: [{ type: "TOKENS_LIMIT", percentage: 150.0 }],
        },
      }),
    );

    const result = await fetchZaiUsage("test-key");
    expect(result.percentage).toBe(100);
  });

  it("returns 0 when percentage is exactly 0", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      mockFetchResponse({
        success: true,
        data: {
          limits: [{ type: "TOKENS_LIMIT", percentage: 0 }],
        },
      }),
    );

    const result = await fetchZaiUsage("test-key");
    expect(result.percentage).toBe(0);
  });

  it("returns 100 when percentage is exactly 100", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      mockFetchResponse({
        success: true,
        data: {
          limits: [{ type: "TOKENS_LIMIT", percentage: 100 }],
        },
      }),
    );

    const result = await fetchZaiUsage("test-key");
    expect(result.percentage).toBe(100);
  });

  it("handles very small positive percentage (rounds to 0)", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      mockFetchResponse({
        success: true,
        data: {
          limits: [{ type: "TOKENS_LIMIT", percentage: 0.04 }],
        },
      }),
    );

    const result = await fetchZaiUsage("test-key");
    expect(result.percentage).toBe(0);
  });

  it("returns usage data when success response includes msg field", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      mockFetchResponse({
        success: true,
        msg: "Operation successful",
        data: {
          limits: [
            {
              type: "TOKENS_LIMIT",
              percentage: 12.34,
              nextResetTime: 1700000000000,
            },
          ],
        },
      }),
    );

    const result = await fetchZaiUsage("test-key");

    expect(result).toEqual({
      percentage: 12.3,
      resetTimeMs: 1700000000000,
    });
  });

  it("throws on API error response with msg", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      mockFetchResponse({
        success: false,
        code: 401,
        msg: "unauthorized",
      }),
    );

    await expect(fetchZaiUsage("test-key")).rejects.toThrow("Z.ai API error: unauthorized");
  });

  it("throws when TOKENS_LIMIT is missing from response", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      mockFetchResponse({
        success: true,
        data: {
          limits: [{ type: "TIME_LIMIT", percentage: 10.0 }],
        },
      }),
    );

    await expect(fetchZaiUsage("test-key")).rejects.toThrow(
      "No TOKENS_LIMIT found in Z.ai usage response",
    );
  });

  it("throws on network error (fetch rejects)", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("Network error"));

    await expect(fetchZaiUsage("test-key")).rejects.toThrow("Network error");
  });

  it("sends correct headers including Authorization and Accept-Encoding", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      mockFetchResponse({
        success: true,
        data: {
          limits: [{ type: "TOKENS_LIMIT", percentage: 0.0 }],
        },
      }),
    );

    await fetchZaiUsage("test-key");

    expect(globalThis.fetch).toHaveBeenCalledWith(
      "https://api.z.ai/api/monitor/usage/quota/limit",
      expect.objectContaining({
        headers: {
          Authorization: "Bearer test-key",
          "Accept-Encoding": "identity",
        },
      }),
    );
  });

  it("throws with status code when response is not ok (429)", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      mockFetchResponse({ success: false, code: 429, msg: "rate limited" }, false, 429),
    );

    await expect(fetchZaiUsage("test-key")).rejects.toThrow("status 429");
  });

  it("throws with status code when response is not ok (500)", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      mockFetchResponse({ success: false, code: 500, msg: "internal server error" }, false, 500),
    );

    await expect(fetchZaiUsage("test-key")).rejects.toThrow("status 500");
  });

  it.each(["identity", "gzip", "deflate", "br", "GZIP"])(
    "accepts a known-safe Content-Encoding response header (%s)",
    async (encoding) => {
      vi.spyOn(globalThis, "fetch").mockResolvedValue(
        mockFetchResponse(
          {
            success: true,
            data: { limits: [{ type: "TOKENS_LIMIT", percentage: 10 }] },
          },
          true,
          200,
          encoding,
        ),
      );

      await expect(fetchZaiUsage("test-key")).resolves.toEqual({
        percentage: 10,
        resetTimeMs: undefined,
      });
    },
  );

  it("throws a plain, catchable Error instead of reading the body when Content-Encoding is zstd", async () => {
    const response = mockFetchResponse(
      { success: true, data: { limits: [{ type: "TOKENS_LIMIT", percentage: 10 }] } },
      true,
      200,
      "zstd",
    );
    vi.spyOn(globalThis, "fetch").mockResolvedValue(response);

    await expect(fetchZaiUsage("test-key")).rejects.toThrow(
      "Z.ai API returned unsupported Content-Encoding: zstd",
    );
    // The body must never be read for an unsupported encoding: on Node versions whose
    // zlib lacks zstd support, undici crashes the whole process while decoding the body,
    // not while resolving fetch()'s promise.
    expect(response.json).not.toHaveBeenCalled();
  });
});
