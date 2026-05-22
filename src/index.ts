// Z.ai usage monitor extension entry point

import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { fetchZaiUsage, isZaiProvider } from "./api.js";
import type { ZaiUsageData } from "./api.js";
import { UsageCache } from "./usage-cache.js";

const cache = new UsageCache();

async function refreshUsage(ctx: ExtensionContext): Promise<void> {
  if (!ctx.hasUI) return;
  if (!isZaiProvider(ctx.model?.provider)) {
    ctx.ui.setStatus("zai-usage", undefined);
    return;
  }
  const cached: ZaiUsageData | null = cache.get();
  if (cached) {
    publishStatus(ctx, cached);
    return;
  }
  try {
    const apiKey: string | undefined =
      await ctx.modelRegistry.getApiKeyForProvider("zai");
    if (!apiKey) return;
    const data: ZaiUsageData = await fetchZaiUsage(apiKey);
    cache.set(data);
    publishStatus(ctx, data);
  } catch (error: unknown) {
    console.error("[pi-zai-usage]", error);
  }
}

function publishStatus(ctx: ExtensionContext, data: ZaiUsageData): void {
  ctx.ui.setStatus(
    "zai-usage",
    JSON.stringify({
      percentage: data.percentage,
      resetTimeMs: data.resetTimeMs,
    }),
  );
}

function clearStatus(ctx: ExtensionContext): void {
  if (!ctx.hasUI) return;
  ctx.ui.setStatus("zai-usage", undefined);
}

export default function (pi: ExtensionAPI): void {
  pi.on("session_start", async (_event, ctx) => {
    await refreshUsage(ctx);
  });
  pi.on("model_select", async (_event, ctx) => {
    cache.clear();
    await refreshUsage(ctx);
  });
  pi.on("turn_end", async (_event, ctx) => {
    await refreshUsage(ctx);
  });
  pi.on("session_shutdown", (_event, ctx) => {
    clearStatus(ctx);
  });
}
