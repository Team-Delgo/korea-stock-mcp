import type { AppConfig } from "../config.js";
import { getKisAccessToken } from "../services/kis-auth.js";

export class KisApiError extends Error {
  constructor(
    public readonly rtCd: string,
    message: string
  ) {
    super(message);
    this.name = "KisApiError";
  }
}

function baseUrl(cfg: AppConfig): string {
  return cfg.kis.env === "real" ? cfg.kis.baseUrlReal : cfg.kis.baseUrlPaper;
}

function effectiveTrId(trId: string, cfg: AppConfig): string {
  if (cfg.kis.env === "paper" && trId.startsWith("F")) {
    return "V" + trId.slice(1);
  }
  return trId;
}

export async function kisGet<T>(
  path: string,
  trId: string,
  params: Record<string, string>,
  cfg: AppConfig
): Promise<T> {
  const token = await getKisAccessToken(cfg);

  const url = new URL(path, baseUrl(cfg));
  for (const [k, v] of Object.entries(params)) {
    url.searchParams.set(k, v);
  }

  const res = await fetch(url.toString(), {
    method: "GET",
    headers: {
      Authorization: `Bearer ${token}`,
      appkey: cfg.kis.appKey ?? "",
      appsecret: cfg.kis.appSecret ?? "",
      tr_id: effectiveTrId(trId, cfg),
      custtype: "P",
    },
  });

  if (!res.ok) {
    const errBody = await Promise.resolve().then(() => res.text()).catch(() => "(unreadable)");
    throw new Error(`KIS HTTP error: ${res.status} ${path} — ${errBody}`);
  }

  const body = (await res.json()) as { rt_cd?: string; msg1?: string } & T;

  if (body.rt_cd !== "0") {
    throw new KisApiError(
      body.rt_cd ?? "unknown",
      body.msg1 ?? "KIS API error"
    );
  }

  return body;
}
