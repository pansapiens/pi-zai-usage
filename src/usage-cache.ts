// Usage data caching with TTL cooldown

import type { ZaiUsageData } from "./api.js";

export const CACHE_TTL_MS = 30_000;

export class UsageCache {
  private data: ZaiUsageData | null = null;
  private fetchedAt = 0;

  get(): ZaiUsageData | null {
    if (this.data !== null && Date.now() - this.fetchedAt <= CACHE_TTL_MS) {
      return this.data;
    }
    return null;
  }

  set(data: ZaiUsageData): void {
    this.data = data;
    this.fetchedAt = Date.now();
  }

  clear(): void {
    this.data = null;
    this.fetchedAt = 0;
  }
}
