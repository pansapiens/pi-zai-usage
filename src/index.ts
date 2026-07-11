// Z.ai usage monitor extension entry point

import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { fetchZaiUsage, isZaiProvider, resolveZaiApiKeyProvider } from "./api.js";
import type { ZaiUsageData } from "./api.js";
import { UsageCache } from "./usage-cache.js";

const cache = new UsageCache();
let refreshPromise: Promise<void> | null = null;
let lastProvider: string | undefined = undefined;

async function refreshUsage(ctx: ExtensionContext): Promise<void> {
  if (refreshPromise) return refreshPromise;
  refreshPromise = doRefresh(ctx).finally(() => {
    refreshPromise = null;
  });
  return refreshPromise;
}

async function doRefresh(ctx: ExtensionContext): Promise<void> {
  if (!ctx.hasUI) {
    console.log("[pi-zai-usage] No UI available");
    return;
  }
  
  console.log("[pi-zai-usage] Refreshing usage data...");
  
  const currentProvider = ctx.model?.provider;
  console.log("[pi-zai-usage] Current provider:", currentProvider);
  
  if (!isZaiProvider(currentProvider)) {
    console.log("[pi-zai-usage] Not a zai provider, clearing status");
    ctx.ui.setStatus("zai-usage", undefined);
    return;
  }
  
  const cached: ZaiUsageData | null = cache.get();
  if (cached) {
    console.log("[pi-zai-usage] Using cached data:", JSON.stringify({
      percentage: cached.percentage,
      resetTimeMs: cached.resetTimeMs
    }));
    publishStatus(ctx, cached);
    return;
  }
  
  // Show loading status while fetching
  ctx.ui.setStatus("zai-usage", "Z.AI: loading...");
  
  try {
    const providerName = resolveZaiApiKeyProvider(currentProvider);
    console.log("[pi-zai-usage] Resolved API key provider:", providerName);
    
    const apiKey: string | undefined = await ctx.modelRegistry.getApiKeyForProvider(providerName);
    if (!apiKey) {
      console.log("[pi-zai-usage] No API key found for provider:", providerName);
      ctx.ui.setStatus("zai-usage", "Z.AI: no API key");
      return;
    }
    
    console.log("[pi-zai-usage] Fetching usage data...");
    const data: ZaiUsageData = await fetchZaiUsage(apiKey);
    console.log("[pi-zai-usage] Usage data fetched:", JSON.stringify({
      percentage: data.percentage,
      resetTimeMs: data.resetTimeMs
    }));
    
    cache.set(data);
    publishStatus(ctx, data);
  } catch (error: unknown) {
    console.error("[pi-zai-usage] Error fetching usage:", error);
    ctx.ui.setStatus("zai-usage", "Z.AI: error");
  }
}

function formatTimeUntilReset(resetTimeMs: number | undefined): string {
  if (!resetTimeMs) return "";
  const now = Date.now();
  const diff = Math.max(0, resetTimeMs - now);
  const days = Math.floor(diff / (1000 * 60 * 60 * 24));
  const hours = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
  const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));

  const parts: string[] = [];
  if (days > 0) parts.push(`${days}d`);
  if (hours > 0) parts.push(`${hours}h`);
  if (minutes > 0) parts.push(`${minutes}m`);

  const durationStr = parts.join(" ");
  if (!durationStr) return "";

  // Add local reset time
  const resetDate = new Date(resetTimeMs);
  const nowDate = new Date(now);
  const isToday =
    resetDate.getDate() === nowDate.getDate() &&
    resetDate.getMonth() === nowDate.getMonth() &&
    resetDate.getFullYear() === nowDate.getFullYear();

  const timeStr = resetDate.toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).toLowerCase();

  if (isToday) {
    return `(${durationStr} @ ${timeStr})`;
  } else {
    const dateStr = resetDate.toLocaleDateString("en-US", {
      day: "numeric",
      month: "short",
      year: "numeric",
    }).replace(/, /g, "-");
    return `(${durationStr} @ ${timeStr} ${dateStr})`;
  }
}

function publishStatus(ctx: ExtensionContext, data: ZaiUsageData): void {
  const resetText = formatTimeUntilReset(data.resetTimeMs);
  const compactText = `Z.AI: ${data.percentage}% ${resetText}`.trim();
  ctx.ui.setStatus("zai-usage", compactText);
}

function clearStatus(ctx: ExtensionContext): void {
  if (!ctx.hasUI) return;
  ctx.ui.setStatus("zai-usage", undefined);
}

export default function (pi: ExtensionAPI): void {
  pi.on("session_start", async (_event, ctx) => {
    await refreshUsage(ctx);
    lastProvider = ctx.model?.provider;
  });
  pi.on("model_select", async (_event, ctx) => {
    const provider: string | undefined = ctx.model?.provider;
    if (provider !== lastProvider) {
      cache.clear();
    }
    lastProvider = provider;
    await refreshUsage(ctx);
  });
  pi.on("turn_end", async (_event, ctx) => {
    await refreshUsage(ctx);
  });
  pi.on("session_shutdown", (_event, ctx) => {
    clearStatus(ctx);
  });

  // Register slash command to manually refresh usage
  pi.registerCommand("zai-usage", {
    description: "Show and refresh Z.AI usage status",
    handler: async (_args, ctx) => {
      cache.clear(); // Force refresh
      await refreshUsage(ctx);
      
      const cached = cache.get();
      if (cached) {
        const resetText = formatTimeUntilReset(cached.resetTimeMs);
        const message = `Z.AI Usage: ${cached.percentage}%${resetText}`;
        const statusText = `Z.AI: ${cached.percentage}% ${resetText}`.trim();
        ctx.ui.notify(message, "info");
        ctx.ui.setStatus("zai-usage", statusText);
        console.log("[pi-zai-usage] Status published:", statusText);
      } else {
        const provider = ctx.model?.provider;
        if (!isZaiProvider(provider)) {
          ctx.ui.notify(`Not using Z.AI provider (current: ${provider})`, "warning");
        } else {
          ctx.ui.notify("Failed to fetch usage data. Check console for errors.", "error");
          ctx.ui.setStatus("zai-usage", "Z.AI: error");
        }
      }
    },
  });
}
