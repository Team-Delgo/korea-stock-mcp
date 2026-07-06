interface CacheEntry {
  data: unknown;
  expiresAt: number;
  as_of: string;
}

const _cache = new Map<string, CacheEntry>();
const CACHE_TTL_MS = 60_000;

export const CACHE_TTL_SEC = 60;

function cacheLog(op: "HIT" | "MISS" | "SET", key: string, extra?: string): void {
  if (process.env.LOG_LEVEL === "silent") return;
  const tag = op.padEnd(4);
  const suffix = extra ? `  ${extra}` : "";
  console.log(`[KIS cache] ${tag} ${key}${suffix}`);
}

export function kisGetCached<T>(key: string): { data: T; as_of: string } | null {
  const entry = _cache.get(key);
  if (!entry) {
    cacheLog("MISS", key);
    return null;
  }
  if (Date.now() > entry.expiresAt) {
    _cache.delete(key);
    cacheLog("MISS", key);
    return null;
  }
  const ageMs = Date.now() - new Date(entry.as_of).getTime();
  cacheLog("HIT", key, `age=${Math.round(ageMs / 1000)}s`);
  return { data: entry.data as T, as_of: entry.as_of };
}

export function kisSetCached(key: string, data: unknown): void {
  _cache.set(key, {
    data,
    expiresAt: Date.now() + CACHE_TTL_MS,
    as_of: new Date().toISOString(),
  });
  cacheLog("SET", key, `ttl=${CACHE_TTL_SEC}s`);
}

export function clearKisResponseCache(): void {
  _cache.clear();
}
