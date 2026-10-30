// Z.ai usage monitor extension entry point

import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { fetchOpenRouterUsage, fetchZaiUsage, isZaiProvider } from "./api.js";
import type { ZaiUsageData } from "./api.js";
import { UsageCache } from "./usage-cache.js";

const cache = new UsageCache();
let refreshPromise: Promise<void> | null = null;

// Find a Z.AI key independent of the active model: try the current provider if
// it is a Z.AI one, then "zai", then any other Z.AI-like provider pi knows about.
async function getZaiApiKey(ctx: ExtensionContext): Promise<string | undefined> {
  const names = new Set<string>();
  const current = ctx.model?.provider;
  if (current && isZaiProvider(current)) names.add(current);
  names.add("zai");
  for (const m of ctx.modelRegistry.getAll()) {
    if (isZaiProvider(m.provider)) names.add(m.provider);
  }
  for (const name of names) {
    const key = await ctx.modelRegistry.getApiKeyForProvider(name);
    if (key) return key;
  }
  return undefined;
}

// Cached usage, or a fresh fetch. Returns null when no Z.AI key is configured.
async function loadUsage(ctx: ExtensionContext, force: boolean): Promise<ZaiUsageData | null> {
  if (force) cache.clear();
  const cached = cache.get();
  if (cached) return cached;
  const apiKey = await getZaiApiKey(ctx);
  if (!apiKey) return null;
  const data = await fetchZaiUsage(apiKey);
  cache.set(data);
  return data;
}

async function refreshUsage(ctx: ExtensionContext, force = false): Promise<void> {
  if (refreshPromise) return refreshPromise;
  refreshPromise = doRefresh(ctx, force).finally(() => {
    refreshPromise = null;
  });
  return refreshPromise;
}

async function doRefresh(ctx: ExtensionContext, force: boolean): Promise<void> {
  if (!ctx.hasUI) return;
  try {
    const data = await loadUsage(ctx, force);
    if (data) publishStatus(ctx, data);
    else ctx.ui.setStatus("zai-usage", undefined);
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

// Plain-text usage report for the agent tool and slash command.
async function getUsageText(ctx: ExtensionContext, force: boolean): Promise<string> {
  const data = await loadUsage(ctx, force);
  if (!data) {
    return "No Z.AI API key found (checked pi provider credentials and ZAI_API_KEY env).";
  }
  const resetText = formatTimeUntilReset(data.resetTimeMs);
  return `Z.AI token quota: ${data.percentage}% used${resetText ? `, resets ${resetText}` : ""}.`;
}

export default function (pi: ExtensionAPI): void {
  pi.on("session_start", async (_event, ctx) => {
    await refreshUsage(ctx);
  });
  pi.on("turn_end", async (_event, ctx) => {
    await refreshUsage(ctx);
  });
  pi.on("session_shutdown", (_event, ctx) => {
    if (ctx.hasUI) ctx.ui.setStatus("zai-usage", undefined);
  });

  // Register an agent-callable tool so the LLM can check its own quota
  pi.registerTool({
    name: "zai_usage",
    label: "Z.AI Usage",
    description:
      "Report Z.AI (GLM) token quota usage: percentage of the window quota consumed and the reset time. Works whichever model is active, using the configured Z.AI API key. Use when asked about remaining Z.AI quota, or before deciding whether to pause work to conserve quota.",
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
        const apiKey: string | undefined =
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
      try {
        ctx.ui.notify(await getUsageText(ctx, true), "info");
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        ctx.ui.notify(`Failed to fetch Z.AI usage: ${message}`, "error");
      }
      await refreshUsage(ctx);
    },
  });
}
