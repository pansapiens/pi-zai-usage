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

export function resolveZaiApiKeyProvider(provider: string | undefined): string {
  return provider?.toLowerCase() ?? "zai";
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
