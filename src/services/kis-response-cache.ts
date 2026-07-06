interface CacheEntry {
  data: unknown;
  expiresAt: number;
  as_of: string;
}

const _cache = new Map<string, CacheEntry>();
const CACHE_TTL_MS = 60_000;

export const CACHE_TTL_SEC = 60;

export function kisGetCached<T>(key: string): { data: T; as_of: string } | null {
  const entry = _cache.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    _cache.delete(key);
    return null;
  }
  return { data: entry.data as T, as_of: entry.as_of };
}

export function kisSetCached(key: string, data: unknown): void {
  _cache.set(key, {
    data,
    expiresAt: Date.now() + CACHE_TTL_MS,
    as_of: new Date().toISOString(),
  });
}

export function clearKisResponseCache(): void {
  _cache.clear();
}
