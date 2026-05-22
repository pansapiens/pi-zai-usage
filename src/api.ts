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

export function isZaiProvider(provider: string | undefined): boolean {
  return provider?.toLowerCase().startsWith("zai") ?? false;
}

export async function fetchZaiUsage(apiKey: string): Promise<ZaiUsageData> {
  const response: Response = await fetch(
    "https://api.z.ai/api/monitor/usage/quota/limit",
    {
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Accept-Encoding": "identity",
      },
      signal: AbortSignal.timeout(10_000),
    },
  );

  const json: ZaiUsageResponse | ZaiApiError =
    (await response.json()) as ZaiUsageResponse | ZaiApiError;

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

  const percentage: number =
    Math.round(tokenLimit.percentage * 10) / 10;
  const resetTimeMs: number | undefined = tokenLimit.nextResetTime;

  return { percentage, resetTimeMs };
}
