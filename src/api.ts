// Z.ai API interaction, response types, and provider detection

export interface ZaiUsageData {
  percentage: number;
  resetTimeMs?: number;
}

interface ZaiLimit {
  type: string;
  percentage: number;
  nextResetTime?: number;
}

interface ZaiUsageResponse {
  data: {
    limits: ZaiLimit[];
  };
  success: boolean;
  msg?: string;
}

interface ZaiApiError {
  code: number;
  msg: string;
  success: false;
}

const ZAI_PROVIDERS = ["zai", "z-ai"];

export interface OpenRouterUsageData {
  label: string;
  limit: number | null;
  limitRemaining: number | null;
  usageMonthly: number;
  usageDaily: number;
  usageWeekly: number;
  isFreeTier: boolean;
  expiresAt: string | null;
  totalCredits: number | null;
  totalUsage: number | null;
}

// Content-Encodings that Node's zlib module can decompress on every currently
// supported Node version. "zstd" is deliberately excluded: zlib.createZstdDecompress
// only exists on Node >=22.15/23.8, and undici throws an uncatchable TypeError
// (not a rejected promise) when it encounters a zstd response on older Node, which
// takes down the whole pi process. Rejecting early here keeps that failure inside
// a normal, catchable Error.
const SAFE_CONTENT_ENCODINGS = new Set(["identity", "gzip", "deflate", "br"]);

export function isZaiProvider(provider: string | undefined): boolean {
  const p = provider?.toLowerCase() ?? "";
  return ZAI_PROVIDERS.some(
    (name) => p === name || p.startsWith(name + ".") || p.startsWith(name + "/"),
  );
}

export async function fetchZaiUsage(apiKey: string): Promise<ZaiUsageData> {
  const response: Response = await fetch("https://api.z.ai/api/monitor/usage/quota/limit", {
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Accept-Encoding": "identity",
    },
    signal: AbortSignal.timeout(10_000),
  });

  const contentEncoding = response.headers.get("content-encoding");
  if (contentEncoding && !SAFE_CONTENT_ENCODINGS.has(contentEncoding.toLowerCase())) {
    throw new Error(`Z.ai API returned unsupported Content-Encoding: ${contentEncoding}`);
  }

  if (!response.ok) {
    throw new Error(`Z.ai API request failed with status ${response.status}`);
  }

  const json: ZaiUsageResponse | ZaiApiError = (await response.json()) as
    | ZaiUsageResponse
    | ZaiApiError;

  if (!json.success) {
    throw new Error(`Z.ai API error: ${(json as ZaiApiError).msg}`);
  }

  const usageResponse = json;
  const tokenLimit: ZaiLimit | undefined = usageResponse.data.limits.find(
    (limit: ZaiLimit): boolean => limit.type === "TOKENS_LIMIT",
  );

  if (!tokenLimit) {
    throw new Error("No TOKENS_LIMIT found in Z.ai usage response");
  }

  const percentage: number = Math.max(
    0,
    Math.min(100, Math.round(tokenLimit.percentage * 10) / 10),
  );
  const resetTimeMs: number | undefined = tokenLimit.nextResetTime;

  return { percentage, resetTimeMs };
}

export async function fetchOpenRouterUsage(
  apiKey: string,
): Promise<OpenRouterUsageData> {
  const response: Response = await fetch("https://openrouter.ai/api/v1/auth/key", {
    headers: { Authorization: `Bearer ${apiKey}` },
    signal: AbortSignal.timeout(10_000),
  });

  if (!response.ok) {
    throw new Error(`OpenRouter API request failed with status ${response.status}`);
  }

  const json = (await response.json()) as { data?: Record<string, unknown> };
  const d = json.data;
  if (!d) {
    throw new Error("OpenRouter API response missing data");
  }

  const data: OpenRouterUsageData = {
    label: String(d.label ?? "unknown"),
    limit: typeof d.limit === "number" ? d.limit : null,
    limitRemaining: typeof d.limit_remaining === "number" ? d.limit_remaining : null,
    usageMonthly: Number(d.usage_monthly ?? 0),
    usageDaily: Number(d.usage_daily ?? 0),
    usageWeekly: Number(d.usage_weekly ?? 0),
    isFreeTier: Boolean(d.is_free_tier),
    expiresAt: typeof d.expires_at === "string" ? d.expires_at : null,
    totalCredits: null,
    totalUsage: null,
  };

  // Prepaid credit balance is a separate endpoint; best-effort so a failure
  // there doesn't discard the quota data already fetched.
  try {
    const creditsResponse: Response = await fetch("https://openrouter.ai/api/v1/credits", {
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(10_000),
    });
    if (creditsResponse.ok) {
      const creditsJson = (await creditsResponse.json()) as { data?: Record<string, unknown> };
      const c = creditsJson.data;
      if (c) {
        data.totalCredits = typeof c.total_credits === "number" ? c.total_credits : null;
        data.totalUsage = typeof c.total_usage === "number" ? c.total_usage : null;
      }
    }
  } catch {
    // keep quota data, leave credit fields null
  }

  return data;
}
