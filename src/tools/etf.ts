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
import { searchStocks } from "../utils/stock-resolver.js";
import { getEtfMaster, type EtfMasterRecord } from "../utils/etf-resolver.js";
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

/**
 * Resolves a name/code query to a single ETF code for KIS API calls.
 * Returns the code string on success, or a ready-to-return tool response on failure.
 */
function resolveEtfCode(input: string): { stock_code: string } | ReturnType<typeof jsonToolResponse> {
  const matches = searchStocks(input, getEtfMaster());
  const meta = createMeta("KIS", "etf-master-local");
  if (matches.length === 0) {
    return jsonToolResponse(
      { ok: false, error: { code: "NO_DATA", message: `ETF를 찾을 수 없습니다: ${input}` }, meta },
      true
    );
  }
  if (matches.length > 1) {
    return jsonToolResponse(
      {
        ok: false,
        error: {
          code: "AMBIGUOUS",
          message: `'${input}'에 해당하는 ETF가 여러 개입니다. stock_code(6자리)로 다시 시도해주세요.`,
          candidates: matches.map((r: EtfMasterRecord) => ({ stock_code: r.stock_code, name: r.name })),
        },
        meta,
      },
      true
    );
  }
  return { stock_code: matches[0].stock_code };
}

export function registerEtfTools(server: McpServer, cfg: AppConfig) {
  // ── resolve_etf ────────────────────────────────────────────────────────────

  server.registerTool(
    "resolve_etf",
    {
      title: "ETF 검색",
      description: "ETF명(부분/약칭 포함)으로 KIS 종목코드를 검색합니다.",
      inputSchema: {
        query: z.string().min(1),
        limit: z.number().int().positive().max(50).default(10),
      },
      outputSchema: envelopeOutputSchema,
      annotations: READ_ONLY,
    },
    async ({ query, limit }) => {
      const matches = searchStocks(query.trim(), getEtfMaster())
        .slice(0, limit)
        .map((r) => ({ stock_code: r.stock_code, name: r.name }));

      if (matches.length === 0) {
        return jsonToolResponse(
          { ok: false, error: { code: "NO_DATA", message: `No ETF found for: ${query.trim()}` }, meta: createMeta("KIS", "etf-master-local") },
          true
        );
      }

      return jsonToolResponse(
        successEnvelope({ matches }, createMeta("KIS", "etf-master-local"))
      );
    }
  );

  // ── etf_get_quote ──────────────────────────────────────────────────────────

  server.registerTool(
    "etf_get_quote",
    {
      title: "ETF/ETN 현재가 조회",
      description: "국내 ETF/ETN의 현재가, NAV, 추적오차율, 괴리율 등 시세 정보를 조회합니다. 6자리 종목코드 또는 ETF명을 입력할 수 있습니다.",
      inputSchema: {
        stock_code: z.string().min(1).describe("6자리 종목코드 또는 ETF명 (예: 069500, KODEX 200)"),
        market_div_code: z.string().default("J"),
      },
      outputSchema: envelopeOutputSchema,
      annotations: READ_ONLY,
    },
    async ({ stock_code: input, market_div_code }) => {
      const resolved = resolveEtfCode(input);
      if (!("stock_code" in resolved)) return resolved;
      const stock_code = resolved.stock_code;

      type QuoteBody = {
        output: {
          stck_prpr: string; prdy_vrss_sign: string; prdy_vrss: string; prdy_ctrt: string;
          acml_vol: string; prdy_vol: string; stck_mxpr: string; stck_llam: string;
          stck_prdy_clpr: string; stck_oprc: string; stck_hgpr: string; stck_lwpr: string;
          prdy_last_nav: string; nav: string; nav_prdy_vrss: string; nav_prdy_vrss_sign: string;
          nav_prdy_ctrt: string; trc_errt: string; stck_sdpr: string; stck_sspr: string;
          etf_crcl_stcn: string; etf_ntas_ttam: string; frgn_limt_rate: string;
          frgn_oder_able_qty: string; etf_cu_unit_scrt_cnt: string; etf_cnfg_issu_cnt: string;
          etf_dvdn_cycl: string; crcd: string; lp_oder_able_cls_code: string;
          stck_dryy_hgpr: string; dryy_hgpr_date: string; stck_dryy_lwpr: string; dryy_lwpr_date: string;
          bstp_kor_isnm: string; vi_cls_code: string; lstn_stcn: string;
          frgn_hldn_qty: string; frgn_hldn_qty_rate: string; etf_trc_ert_mltp: string;
          dprt: string; mbcr_name: string; stck_lstn_date: string; mtrt_date: string;
          etf_div_name: string; etf_rprs_bstp_kor_isnm: string;
        };
      };
      const cacheKey = `FHPST02400000:${stock_code}:${market_div_code}`;
      const cacheHit = kisGetCached<QuoteBody>(cacheKey);

      let body: QuoteBody;
      try {
        body = cacheHit?.data ?? await kisGet<QuoteBody>(
          "/uapi/etfetn/v1/quotations/inquire-price",
          "FHPST02400000",
          { fid_cond_mrkt_div_code: market_div_code, fid_input_iscd: stock_code },
          cfg
        );
        if (!cacheHit) kisSetCached(cacheKey, body);
      } catch (err) {
        return jsonToolResponse(kisToolError(err, "etfetn-inquire-price"), true);
      }

      const o = body.output;
      const meta = cacheHit
        ? { ...createMeta("CACHE", "etfetn-inquire-price"), as_of: cacheHit.as_of, cached: true, cache_ttl_sec: CACHE_TTL_SEC }
        : createMeta("KIS", "etfetn-inquire-price");
      return jsonToolResponse(
        successEnvelope(
          {
            stock_code,
            price: Number(o.stck_prpr),
            change: Number(o.prdy_vrss),
            change_sign: o.prdy_vrss_sign,
            change_rate: Number(o.prdy_ctrt),
            volume: Number(o.acml_vol),
            prev_volume: Number(o.prdy_vol),
            upper_limit: Number(o.stck_mxpr),
            lower_limit: Number(o.stck_llam),
            prev_close: Number(o.stck_prdy_clpr),
            open: Number(o.stck_oprc),
            high: Number(o.stck_hgpr),
            low: Number(o.stck_lwpr),
            nav: Number(o.nav),
            nav_prev_close: Number(o.prdy_last_nav),
            nav_change: Number(o.nav_prdy_vrss),
            nav_change_sign: o.nav_prdy_vrss_sign,
            nav_change_rate: Number(o.nav_prdy_ctrt),
            tracking_error_rate: Number(o.trc_errt),
            premium_discount_rate: Number(o.dprt),
            tracking_multiple: Number(o.etf_trc_ert_mltp),
            base_price: Number(o.stck_sdpr),
            substitute_price: Number(o.stck_sspr),
            circulating_shares: Number(o.etf_crcl_stcn),
            listed_shares: Number(o.lstn_stcn),
            net_asset_total: Number(o.etf_ntas_ttam),
            foreign_limit_rate: Number(o.frgn_limt_rate),
            foreign_order_available_qty: Number(o.frgn_oder_able_qty),
            foreign_holding_qty: Number(o.frgn_hldn_qty),
            foreign_holding_rate: Number(o.frgn_hldn_qty_rate),
            cu_unit_shares: Number(o.etf_cu_unit_scrt_cnt),
            holdings_count: Number(o.etf_cnfg_issu_cnt),
            dividend_cycle: o.etf_dvdn_cycl,
            currency: o.crcd,
            lp_order_available: o.lp_oder_able_cls_code === "Y",
            year_high: Number(o.stck_dryy_hgpr),
            year_high_date: o.dryy_hgpr_date,
            year_low: Number(o.stck_dryy_lwpr),
            year_low_date: o.dryy_lwpr_date,
            sector: o.bstp_kor_isnm,
            vi_class_code: o.vi_cls_code,
            asset_manager: o.mbcr_name,
            listed_date: o.stck_lstn_date,
            maturity_date: o.mtrt_date,
            etf_type: o.etf_div_name,
            tracking_index: o.etf_rprs_bstp_kor_isnm,
          },
          meta
        )
      );
    }
  );

  // ── etf_get_holdings ───────────────────────────────────────────────────────

  server.registerTool(
    "etf_get_holdings",
    {
      title: "ETF 구성종목 조회",
      description: "ETF의 구성종목별 비중과 시세 정보를 조회합니다. 6자리 종목코드 또는 ETF명을 입력할 수 있습니다.",
      inputSchema: {
        stock_code: z.string().min(1).describe("6자리 종목코드 또는 ETF명"),
        market_div_code: z.string().default("J"),
        limit: z.number().int().positive().max(200).default(30),
      },
      outputSchema: envelopeOutputSchema,
      annotations: READ_ONLY,
    },
    async ({ stock_code: input, market_div_code, limit }) => {
      const resolved = resolveEtfCode(input);
      if (!("stock_code" in resolved)) return resolved;
      const stock_code = resolved.stock_code;

      type HoldingsBody = {
        output1: {
          stck_prpr: string; prdy_vrss: string; prdy_vrss_sign: string; prdy_ctrt: string;
          etf_cnfg_issu_avls: string; nav: string; nav_prdy_vrss_sign: string;
          nav_prdy_vrss: string; nav_prdy_ctrt: string; etf_ntas_ttam: string;
          prdy_clpr_nav: string; oprc_nav: string; hprc_nav: string; lprc_nav: string;
          etf_cu_unit_scrt_cnt: string; etf_cnfg_issu_cnt: string;
        };
        output2: Array<{
          stck_shrn_iscd: string; hts_kor_isnm: string; stck_prpr: string;
          prdy_vrss: string; prdy_vrss_sign: string; prdy_ctrt: string;
          acml_vol: string; acml_tr_pbmn: string; tday_rsfl_rate: string;
          prdy_vrss_vol: string; tr_pbmn_tnrt: string; hts_avls: string;
          etf_cnfg_issu_avls: string; etf_cnfg_issu_rlim: string; etf_vltn_amt: string;
        }>;
      };
      const cacheKey = `FHKST121600C0:${stock_code}:${market_div_code}`;
      const cacheHit = kisGetCached<HoldingsBody>(cacheKey);

      let body: HoldingsBody;
      try {
        body = cacheHit?.data ?? await kisGet<HoldingsBody>(
          "/uapi/etfetn/v1/quotations/inquire-component-stock-price",
          "FHKST121600C0",
          { fid_cond_mrkt_div_code: market_div_code, fid_input_iscd: stock_code, fid_cond_scr_div_code: "11216" },
          cfg
        );
        if (!cacheHit) kisSetCached(cacheKey, body);
      } catch (err) {
        return jsonToolResponse(kisToolError(err, "etfetn-inquire-component-stock-price"), true);
      }

      const o1 = body.output1;
      const holdings = (body.output2 ?? []).slice(0, limit).map((r) => ({
        stock_code: r.stck_shrn_iscd,
        name: r.hts_kor_isnm,
        price: Number(r.stck_prpr),
        change: Number(r.prdy_vrss),
        change_sign: r.prdy_vrss_sign,
        change_rate: Number(r.prdy_ctrt),
        day_change_rate: Number(r.tday_rsfl_rate),
        volume: Number(r.acml_vol),
        volume_change: Number(r.prdy_vrss_vol),
        trading_value: Number(r.acml_tr_pbmn),
        turnover_rate: Number(r.tr_pbmn_tnrt),
        market_cap: Number(r.hts_avls),
        weight: Number(r.etf_cnfg_issu_rlim),
        constituent_market_cap: Number(r.etf_cnfg_issu_avls),
        valuation_amount: Number(r.etf_vltn_amt),
      }));

      if (holdings.length === 0) {
        return jsonToolResponse(
          {
            ok: false,
            error: { code: "NO_DATA", message: "No holdings found for the given ETF" },
            meta: createMeta("KIS", "etfetn-inquire-component-stock-price"),
          },
          true
        );
      }

      const meta = cacheHit
        ? { ...createMeta("CACHE", "etfetn-inquire-component-stock-price"), as_of: cacheHit.as_of, cached: true, cache_ttl_sec: CACHE_TTL_SEC }
        : createMeta("KIS", "etfetn-inquire-component-stock-price");
      return jsonToolResponse(
        successEnvelope(
          {
            stock_code,
            price: Number(o1.stck_prpr),
            change: Number(o1.prdy_vrss),
            change_sign: o1.prdy_vrss_sign,
            change_rate: Number(o1.prdy_ctrt),
            nav: Number(o1.nav),
            nav_change: Number(o1.nav_prdy_vrss),
            nav_change_sign: o1.nav_prdy_vrss_sign,
            nav_change_rate: Number(o1.nav_prdy_ctrt),
            nav_prev_close: Number(o1.prdy_clpr_nav),
            nav_open: Number(o1.oprc_nav),
            nav_high: Number(o1.hprc_nav),
            nav_low: Number(o1.lprc_nav),
            net_asset_total: Number(o1.etf_ntas_ttam),
            holdings_market_cap: Number(o1.etf_cnfg_issu_avls),
            cu_unit_shares: Number(o1.etf_cu_unit_scrt_cnt),
            holdings_count: Number(o1.etf_cnfg_issu_cnt),
            holdings,
          },
          meta
        )
      );
    }
  );
}
