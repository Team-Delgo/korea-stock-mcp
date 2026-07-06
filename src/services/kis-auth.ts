import type { AppConfig } from "../config.js";

interface TokenCache {
  accessToken: string;
  expiresAt: number;
}

let _cache: TokenCache | null = null;

function kisBaseUrl(cfg: AppConfig): string {
  return cfg.kis.env === "real" ? cfg.kis.baseUrlReal : cfg.kis.baseUrlPaper;
}

export async function getKisAccessToken(cfg: AppConfig): Promise<string> {
  const now = Date.now();
  if (_cache && _cache.expiresAt - 5 * 60 * 1000 > now) {
    return _cache.accessToken;
  }

  if (!cfg.kis.appKey || !cfg.kis.appSecret) {
    throw new Error("KIS_APP_KEY and KIS_APP_SECRET must be configured.");
  }

  const res = await fetch(`${kisBaseUrl(cfg)}/oauth2/tokenP`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      grant_type: "client_credentials",
      appkey: cfg.kis.appKey,
      appsecret: cfg.kis.appSecret,
    }),
  });

  if (!res.ok) {
    const errBody = await res.text().catch(() => "(unreadable)");
    throw new Error(`KIS token request failed: HTTP ${res.status} — ${errBody}`);
  }

  const body = (await res.json()) as {
    access_token?: string;
    expires_in?: number;
  };

  if (!body.access_token) {
    throw new Error("KIS token response did not include access_token.");
  }

  _cache = {
    accessToken: body.access_token,
    expiresAt: now + (body.expires_in ?? 86400) * 1000,
  };

  return _cache.accessToken;
}

export function clearKisTokenCache(): void {
  _cache = null;
}
