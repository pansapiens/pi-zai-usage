// Z.ai usage monitor extension entry point

import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { fetchOpenRouterUsage, fetchZaiUsage, isZaiProvider, resolveZaiApiKeyProvider } from "./api.js";
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

// UI-independent usage lookup for the agent-facing tool: returns a plain-text
// report, or an error string. Uses the cache unless force is set.
async function getUsageText(
  ctx: ExtensionContext,
  force: boolean,
): Promise<string> {
  const provider = ctx.model?.provider;
  if (!isZaiProvider(provider)) {
    return `Not on a Z.AI provider (current: ${provider ?? "unknown"}); no Z.AI quota to report.`;
  }
  if (force) cache.clear();
  let data = cache.get();
  if (!data) {
    const providerName = resolveZaiApiKeyProvider(provider);
    const apiKey = await ctx.modelRegistry.getApiKeyForProvider(providerName);
    if (!apiKey) {
      return `No API key configured for provider ${providerName}.`;
    }
    data = await fetchZaiUsage(apiKey);
    cache.set(data);
  }
  const resetText = formatTimeUntilReset(data.resetTimeMs);
  return `Z.AI token quota: ${data.percentage}% used${resetText ? `, resets ${resetText}` : ""}.`;
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

  // Register an agent-callable tool so the LLM can check its own quota
  pi.registerTool({
    name: "zai_usage",
    label: "Z.AI Usage",
    description:
      "Report Z.AI (GLM) token quota usage for the current API key: percentage of the window quota consumed and the reset time. Use when asked about remaining quota, or before deciding whether to pause work to conserve quota.",
    promptSnippet:
      "Report Z.AI token quota usage (percentage consumed and reset time)",
    parameters: Type.Object({
      refresh: Type.Optional(
        Type.Boolean({
          description:
            "Force a fresh fetch from the API instead of using the cache (default: false)",
        }),
      ),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      try {
        const text = await getUsageText(ctx, params.refresh ?? false);
        return { content: [{ type: "text", text }], details: { report: text } };
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        return { content: [{ type: "text", text: `Failed to fetch Z.AI usage: ${message}` }], details: { error: message } };
      }
    },
  });

  // Register an agent-callable tool for OpenRouter key usage
  pi.registerTool({
    name: "openrouter_usage",
    label: "OpenRouter Usage",
    description:
      "Report OpenRouter API key usage: monthly limit, remaining credit, daily/weekly/monthly spend, and prepaid credit balance. Use when asked about OpenRouter quota, remaining credit, or recent spend.",
    promptSnippet: "Report OpenRouter API key usage (limit, remaining, spend)",
    parameters: Type.Object({}),
    async execute(_toolCallId, _params, _signal, _onUpdate, ctx) {
      try {
        let apiKey: string | undefined =
          (await ctx.modelRegistry.getApiKeyForProvider("openrouter")) ||
          process.env.OPENROUTER_API_KEY;
        if (!apiKey) {
          const text =
            "No OpenRouter API key found (checked pi provider credentials and OPENROUTER_API_KEY env).";
          return { content: [{ type: "text", text }], details: { error: "no key" } };
        }
        const d = await fetchOpenRouterUsage(apiKey);
        const parts: string[] = [`OpenRouter key ${d.label}: `];
        if (d.limit !== null && d.limit > 0) {
          parts.push(
            `$${d.usageMonthly.toFixed(2)} used of $${d.limit.toFixed(2)} monthly limit ` +
              `($${(d.limitRemaining ?? 0).toFixed(2)} remaining)`,
          );
        } else {
          parts.push(`$${d.usageMonthly.toFixed(2)} used this month (no limit set)`);
        }
        parts.push(`; today $${d.usageDaily.toFixed(2)}, week $${d.usageWeekly.toFixed(2)}`);
        if (d.totalCredits !== null) {
          parts.push(
            `; prepaid credits: $${Math.max(0, d.totalCredits - (d.totalUsage ?? 0)).toFixed(2)} left ` +
              `(used $${(d.totalUsage ?? 0).toFixed(2)} / $${d.totalCredits.toFixed(2)})`,
          );
        }
        if (d.isFreeTier) parts.push(" [free tier]");
        if (d.expiresAt) parts.push(`, key expires ${d.expiresAt}`);
        const text = parts.join("") + ".";
        return { content: [{ type: "text", text }], details: { report: text } };
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        return {
          content: [{ type: "text", text: `Failed to fetch OpenRouter usage: ${message}` }],
          details: { error: message },
        };
      }
    },
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
