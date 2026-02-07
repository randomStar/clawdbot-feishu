import type { FeishuProbeResult } from "./types.js";
import { createFeishuClient, type FeishuClientCredentials } from "./client.js";

const PROBE_CACHE_TTL_MS = (() => {
  const envTtl = process.env.FEISHU_PROBE_CACHE_TTL_MINUTES;
  if (envTtl) {
    const minutes = parseInt(envTtl, 10);
    if (!Number.isNaN(minutes) && minutes > 0) {
      return minutes * 60 * 1000;
    }
  }
  return 15 * 60 * 1000;
})();

type ProbeCacheEntry = {
  result: FeishuProbeResult;
  timestamp: number;
};

const probeCache = new Map<string, ProbeCacheEntry>();

function getCacheKey(creds: FeishuClientCredentials): string {
  const domain = creds.domain || "feishu";
  const id = creds.accountId || creds.appId || "default";
  return `${id}:${domain}`;
}

function getCachedResult(creds: FeishuClientCredentials): FeishuProbeResult | null {
  const key = getCacheKey(creds);
  const cached = probeCache.get(key);
  if (!cached) return null;

  if (Date.now() - cached.timestamp > PROBE_CACHE_TTL_MS) {
    probeCache.delete(key);
    return null;
  }

  return cached.result;
}

function setCachedResult(creds: FeishuClientCredentials, result: FeishuProbeResult): void {
  const key = getCacheKey(creds);
  probeCache.set(key, { result, timestamp: Date.now() });
}

export function clearProbeCache(accountId?: string): void {
  if (!accountId) {
    probeCache.clear();
    return;
  }

  for (const key of probeCache.keys()) {
    if (key.startsWith(`${accountId}:`)) {
      probeCache.delete(key);
    }
  }
}

export async function probeFeishu(creds?: FeishuClientCredentials): Promise<FeishuProbeResult> {
  if (!creds?.appId || !creds?.appSecret) {
    return {
      ok: false,
      error: "missing credentials (appId, appSecret)",
    };
  }

  const cached = getCachedResult(creds);
  if (cached) {
    return cached;
  }

  try {
    const client = createFeishuClient(creds);
    // Use bot/v3/info API to get bot information
    const response = await (client as any).request({
      method: "GET",
      url: "/open-apis/bot/v3/info",
      data: {},
    });

    if (response.code !== 0) {
      const result = {
        ok: false,
        appId: creds.appId,
        error: `API error: ${response.msg || `code ${response.code}`}`,
      };
      setCachedResult(creds, result);
      return result;
    }

    const bot = response.bot || response.data?.bot;
    const result = {
      ok: true,
      appId: creds.appId,
      botName: bot?.bot_name,
      botOpenId: bot?.open_id,
    };
    setCachedResult(creds, result);
    return result;
  } catch (err) {
    const result = {
      ok: false,
      appId: creds.appId,
      error: err instanceof Error ? err.message : String(err),
    };
    setCachedResult(creds, result);
    return result;
  }
}
