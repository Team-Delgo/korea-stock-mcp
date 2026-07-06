import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { AppConfig } from "../config.js";
import { kisGet, KisApiError } from "../clients/kis-rest.js";
import { jsonToolResponse } from "./helpers.js";
import {
  createMeta,
  successEnvelope,
  envelopeOutputSchema,
  type ErrorEnvelope,
} from "../schemas/common.js";
import { kisGetCached, kisSetCached, CACHE_TTL_SEC } from "../services/kis-response-cache.js";

const READ_ONLY = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: true,
} as const;

function kisToolError(err: unknown, sourceApi: string): ErrorEnvelope {
  const meta = createMeta("KIS", sourceApi);
  if (err instanceof KisApiError) {
    return { ok: false, error: { code: "UPSTREAM_ERROR", message: err.message }, meta };
  }
  const msg = err instanceof Error ? err.message : String(err);
  if (msg.includes("401")) {
    return { ok: false, error: { code: "AUTH_EXPIRED", message: "KIS token expired" }, meta };
  }
  if (msg.includes("429")) {
    return { ok: false, error: { code: "RATE_LIMITED", message: "KIS rate limit exceeded", retry_after_sec: 1 }, meta };
  }
  return { ok: false, error: { code: "UPSTREAM_ERROR", message: msg }, meta };
}

function marketToIscd(market: "KOSPI" | "KOSDAQ" | "ALL"): string {
  if (market === "KOSPI") return "0001";
  if (market === "KOSDAQ") return "1001";
  return "0000";
}

const NOT_IMPL_TYPES = ["dividend_yield", "short_sale", "credit_balance", "new_high_low"] as const;

export function registerMarketTools(server: McpServer, cfg: AppConfig) {
  server.registerTool(
    "market_get_movers",
    {
      title: "Get Market Movers",
      description:
        "Get Korean stock market rankings by volume, change rate, market cap, or trading value. Max 30 results. Requires real (non-paper) KIS credentials.",
      inputSchema: {
        ranking_type: z.enum([
          "volume",
          "change_rate",
          "market_cap",
          "trading_value",
          "dividend_yield",
          "short_sale",
          "credit_balance",
          "new_high_low",
        ]),
        market: z.enum(["KOSPI", "KOSDAQ", "ALL"]).default("ALL"),
        direction: z.enum(["top", "bottom"]).default("top"),
        limit: z.number().int().positive().max(30).default(30),
      },
      outputSchema: envelopeOutputSchema,
      annotations: READ_ONLY,
    },
    async ({ ranking_type, market, direction, limit }) => {
      if ((NOT_IMPL_TYPES as readonly string[]).includes(ranking_type)) {
        return jsonToolResponse(
          {
            ok: false,
            error: { code: "NOT_IMPLEMENTED", message: `ranking_type '${ranking_type}' is not yet implemented.` },
            meta: createMeta("KIS", "ranking"),
          },
          true
        );
      }

      const iscd = marketToIscd(market);

      try {
        // ── volume / trading_value ────────────────────────────────────────────
        if (ranking_type === "volume" || ranking_type === "trading_value") {
          type VolumeBody = {
            output: Array<{
              hts_kor_isnm: string; mksc_shrn_iscd: string; data_rank: string;
              stck_prpr: string; prdy_vrss: string; prdy_vrss_sign: string;
              prdy_ctrt: string; acml_vol: string; acml_tr_pbmn: string;
            }>;
          };
          const blngCls = ranking_type === "trading_value" ? "3" : "0";
          const cacheKey = `FHPST01710000:${iscd}:${blngCls}`;
          const cacheHit = kisGetCached<VolumeBody>(cacheKey);
          const body = cacheHit?.data ?? await kisGet<VolumeBody>(
            "/uapi/domestic-stock/v1/quotations/volume-rank",
            "FHPST01710000",
            {
              fid_cond_mrkt_div_code: "J",
              fid_cond_scr_div_code: "20171",
              fid_input_iscd: iscd,
              fid_div_cls_code: "0",
              fid_blng_cls_code: blngCls,
              fid_trgt_cls_code: "111111111",
              fid_trgt_exls_cls_code: "0000000000",
              fid_input_price_1: "",
              fid_input_price_2: "",
              fid_vol_cnt: "",
            },
            cfg
          );
          if (!cacheHit) kisSetCached(cacheKey, body);

          let items = (body.output ?? []).map((r) => ({
            rank: Number(r.data_rank),
            stock_code: r.mksc_shrn_iscd,
            name: r.hts_kor_isnm,
            price: Number(r.stck_prpr),
            change: Number(r.prdy_vrss),
            change_sign: r.prdy_vrss_sign,
            change_rate: Number(r.prdy_ctrt),
            volume: Number(r.acml_vol),
            trading_value: Number(r.acml_tr_pbmn),
          }));

          if (direction === "bottom") items = items.reverse();
          items = items.slice(0, limit);

          const meta = cacheHit
            ? { ...createMeta("CACHE", "volume-rank"), as_of: cacheHit.as_of, cached: true, cache_ttl_sec: CACHE_TTL_SEC }
            : createMeta("KIS", "volume-rank");
          return jsonToolResponse(
            successEnvelope({ ranking_type, market, items }, meta)
          );
        }

        // ── change_rate ───────────────────────────────────────────────────────
        if (ranking_type === "change_rate") {
          type FluctuationBody = {
            output: Array<{
              stck_shrn_iscd: string; data_rank: string; hts_kor_isnm: string;
              stck_prpr: string; prdy_vrss: string; prdy_vrss_sign: string;
              prdy_ctrt: string; acml_vol: string;
            }>;
          };
          const cacheKey = `FHPST01700000:${iscd}:${direction}`;
          const cacheHit = kisGetCached<FluctuationBody>(cacheKey);
          const body = cacheHit?.data ?? await kisGet<FluctuationBody>(
            "/uapi/domestic-stock/v1/ranking/fluctuation",
            "FHPST01700000",
            {
              fid_cond_mrkt_div_code: "J",
              fid_cond_scr_div_code: "20170",
              fid_input_iscd: iscd,
              fid_rank_sort_cls_code: direction === "bottom" ? "1" : "0",
              fid_input_cnt_1: "0",
              fid_prc_cls_code: "0",
              fid_input_price_1: "",
              fid_input_price_2: "",
              fid_vol_cnt: "",
              fid_trgt_cls_code: "0",
              fid_trgt_exls_cls_code: "0",
              fid_div_cls_code: "0",
              fid_rsfl_rate1: "",
              fid_rsfl_rate2: "",
            },
            cfg
          );
          if (!cacheHit) kisSetCached(cacheKey, body);

          const items = (body.output ?? []).slice(0, limit).map((r) => ({
            rank: Number(r.data_rank),
            stock_code: r.stck_shrn_iscd,
            name: r.hts_kor_isnm,
            price: Number(r.stck_prpr),
            change: Number(r.prdy_vrss),
            change_sign: r.prdy_vrss_sign,
            change_rate: Number(r.prdy_ctrt),
            volume: Number(r.acml_vol),
          }));

          const meta = cacheHit
            ? { ...createMeta("CACHE", "fluctuation"), as_of: cacheHit.as_of, cached: true, cache_ttl_sec: CACHE_TTL_SEC }
            : createMeta("KIS", "fluctuation");
          return jsonToolResponse(
            successEnvelope({ ranking_type, market, items }, meta)
          );
        }

        // ── market_cap ────────────────────────────────────────────────────────
        type MarketCapBody = {
          output: Array<{
            mksc_shrn_iscd: string; data_rank: string; hts_kor_isnm: string;
            stck_prpr: string; prdy_vrss: string; prdy_vrss_sign: string;
            prdy_ctrt: string; acml_vol: string; stck_avls: string;
          }>;
        };
        const cacheKey = `FHPST01740000:${iscd}`;
        const cacheHit = kisGetCached<MarketCapBody>(cacheKey);
        const body = cacheHit?.data ?? await kisGet<MarketCapBody>(
          "/uapi/domestic-stock/v1/ranking/market-cap",
          "FHPST01740000",
          {
            fid_cond_mrkt_div_code: "J",
            fid_cond_scr_div_code: "20174",
            fid_div_cls_code: "0",
            fid_input_iscd: iscd,
            fid_trgt_cls_code: "0",
            fid_trgt_exls_cls_code: "0",
            fid_input_price_1: "",
            fid_input_price_2: "",
            fid_vol_cnt: "",
          },
          cfg
        );
        if (!cacheHit) kisSetCached(cacheKey, body);

        let items = (body.output ?? []).map((r) => ({
          rank: Number(r.data_rank),
          stock_code: r.mksc_shrn_iscd,
          name: r.hts_kor_isnm,
          price: Number(r.stck_prpr),
          change: Number(r.prdy_vrss),
          change_sign: r.prdy_vrss_sign,
          change_rate: Number(r.prdy_ctrt),
          volume: Number(r.acml_vol),
          market_cap: Number(r.stck_avls),
        }));

        if (direction === "bottom") items = items.reverse();
        items = items.slice(0, limit);

        const meta = cacheHit
          ? { ...createMeta("CACHE", "market-cap"), as_of: cacheHit.as_of, cached: true, cache_ttl_sec: CACHE_TTL_SEC }
          : createMeta("KIS", "market-cap");
        return jsonToolResponse(
          successEnvelope({ ranking_type, market, items }, meta)
        );
      } catch (err) {
        return jsonToolResponse(kisToolError(err, ranking_type), true);
      }
    }
  );
}
