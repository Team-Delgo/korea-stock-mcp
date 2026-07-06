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

const INDEX_ISCD: Record<string, string> = {
  KOSPI: "0001",
  KOSDAQ: "1001",
  KOSPI200: "2001",
};

export function registerMarketTools(server: McpServer, cfg: AppConfig) {
  // ── market_get_index ───────────────────────────────────────────────────────

  server.registerTool(
    "market_get_index",
    {
      title: "시장 지수 조회",
      description:
        "KOSPI, KOSDAQ, KOSPI200 지수의 현재값 또는 일/주/월 단위 가격 이력을 조회합니다.",
      inputSchema: {
        index: z.enum(["KOSPI", "KOSDAQ", "KOSPI200"]).default("KOSPI"),
        mode: z.enum(["quote", "history"]).default("quote"),
        period: z.enum(["D", "W", "M"]).default("D").describe("history 모드 전용"),
        date: z.string().optional().describe("history 모드 기준일 YYYYMMDD (기본: 오늘)"),
        limit: z.number().int().positive().max(100).default(30).describe("history 모드 최대 행 수"),
      },
      outputSchema: envelopeOutputSchema,
      annotations: READ_ONLY,
    },
    async ({ index, mode, period, date, limit }) => {
      const iscd = INDEX_ISCD[index];

      if (mode === "quote") {
        type IndexQuoteBody = {
          output: {
            bstp_nmix_prpr: string; bstp_nmix_prdy_vrss: string; prdy_vrss_sign: string;
            bstp_nmix_prdy_ctrt: string; bstp_nmix_oprc: string; bstp_nmix_hgpr: string;
            bstp_nmix_lwpr: string; acml_vol: string; acml_tr_pbmn: string;
            ascn_issu_cnt: string; stnr_issu_cnt: string; down_issu_cnt: string;
            uplm_issu_cnt: string; lslm_issu_cnt: string;
            total_askp_rsqn: string; total_bidp_rsqn: string; ntby_rsqn: string;
            dryy_bstp_nmix_hgpr: string; dryy_bstp_nmix_hgpr_date: string;
            dryy_bstp_nmix_lwpr: string; dryy_bstp_nmix_lwpr_date: string;
          };
        };
        const cacheKey = `FHPUP02100000:${iscd}`;
        const cacheHit = kisGetCached<IndexQuoteBody>(cacheKey);

        let body: IndexQuoteBody;
        try {
          body = cacheHit?.data ?? await kisGet<IndexQuoteBody>(
            "/uapi/domestic-stock/v1/quotations/inquire-index-price",
            "FHPUP02100000",
            { fid_cond_mrkt_div_code: "U", fid_input_iscd: iscd },
            cfg
          );
          if (!cacheHit) kisSetCached(cacheKey, body);
        } catch (err) {
          return jsonToolResponse(kisToolError(err, "inquire-index-price"), true);
        }

        const o = body.output;
        const meta = cacheHit
          ? { ...createMeta("CACHE", "inquire-index-price"), as_of: cacheHit.as_of, cached: true, cache_ttl_sec: CACHE_TTL_SEC }
          : createMeta("KIS", "inquire-index-price");
        return jsonToolResponse(successEnvelope({
          index, mode: "quote",
          price: Number(o.bstp_nmix_prpr),
          change: Number(o.bstp_nmix_prdy_vrss),
          change_sign: o.prdy_vrss_sign,
          change_rate: Number(o.bstp_nmix_prdy_ctrt),
          open: Number(o.bstp_nmix_oprc),
          high: Number(o.bstp_nmix_hgpr),
          low: Number(o.bstp_nmix_lwpr),
          volume: Number(o.acml_vol),
          trading_value: Number(o.acml_tr_pbmn),
          advances: Number(o.ascn_issu_cnt),
          unchanged: Number(o.stnr_issu_cnt),
          declines: Number(o.down_issu_cnt),
          limit_up: Number(o.uplm_issu_cnt),
          limit_down: Number(o.lslm_issu_cnt),
          total_ask_qty: Number(o.total_askp_rsqn),
          total_bid_qty: Number(o.total_bidp_rsqn),
          net_bid_qty: Number(o.ntby_rsqn),
          year_high: Number(o.dryy_bstp_nmix_hgpr),
          year_high_date: o.dryy_bstp_nmix_hgpr_date,
          year_low: Number(o.dryy_bstp_nmix_lwpr),
          year_low_date: o.dryy_bstp_nmix_lwpr_date,
        }, meta));
      }

      // mode=history → FHPUP02120000
      const today = new Date().toISOString().slice(0, 10).replace(/-/g, "");
      const queryDate = (date ?? today).replace(/-/g, "");

      type IndexHistoryBody = {
        output1: {
          bstp_nmix_prpr: string; bstp_nmix_prdy_vrss: string; prdy_vrss_sign: string;
          bstp_nmix_prdy_ctrt: string; bstp_nmix_oprc: string; bstp_nmix_hgpr: string;
          bstp_nmix_lwpr: string; acml_vol: string; acml_tr_pbmn: string;
          ascn_issu_cnt: string; stnr_issu_cnt: string; down_issu_cnt: string;
          uplm_issu_cnt: string; lslm_issu_cnt: string;
        };
        output2: Array<{
          stck_bsop_date: string; bstp_nmix_prpr: string; bstp_nmix_oprc: string;
          bstp_nmix_hgpr: string; bstp_nmix_lwpr: string; acml_vol: string; acml_tr_pbmn: string;
          bstp_nmix_prdy_vrss: string; prdy_vrss_sign: string; bstp_nmix_prdy_ctrt: string;
        }>;
      };
      const cacheKey = `FHPUP02120000:${iscd}:${period}:${queryDate}`;
      const cacheHit = kisGetCached<IndexHistoryBody>(cacheKey);

      let body: IndexHistoryBody;
      try {
        body = cacheHit?.data ?? await kisGet<IndexHistoryBody>(
          "/uapi/domestic-stock/v1/quotations/inquire-index-daily-price",
          "FHPUP02120000",
          {
            fid_cond_mrkt_div_code: "U",
            fid_input_iscd: iscd,
            fid_period_div_code: period,
            fid_input_date_1: queryDate,
          },
          cfg
        );
        if (!cacheHit) kisSetCached(cacheKey, body);
      } catch (err) {
        return jsonToolResponse(kisToolError(err, "inquire-index-daily-price"), true);
      }

      const o1 = body.output1;
      const rows = (body.output2 ?? []).slice(0, limit).map((r) => ({
        date: r.stck_bsop_date,
        close: Number(r.bstp_nmix_prpr),
        open: Number(r.bstp_nmix_oprc),
        high: Number(r.bstp_nmix_hgpr),
        low: Number(r.bstp_nmix_lwpr),
        volume: Number(r.acml_vol),
        trading_value: Number(r.acml_tr_pbmn),
        change: Number(r.bstp_nmix_prdy_vrss),
        change_sign: r.prdy_vrss_sign,
        change_rate: Number(r.bstp_nmix_prdy_ctrt),
      }));

      const meta = cacheHit
        ? { ...createMeta("CACHE", "inquire-index-daily-price"), as_of: cacheHit.as_of, cached: true, cache_ttl_sec: CACHE_TTL_SEC }
        : createMeta("KIS", "inquire-index-daily-price");
      return jsonToolResponse(successEnvelope({
        index, mode: "history", period,
        summary: {
          price: Number(o1.bstp_nmix_prpr),
          change: Number(o1.bstp_nmix_prdy_vrss),
          change_sign: o1.prdy_vrss_sign,
          change_rate: Number(o1.bstp_nmix_prdy_ctrt),
          open: Number(o1.bstp_nmix_oprc),
          high: Number(o1.bstp_nmix_hgpr),
          low: Number(o1.bstp_nmix_lwpr),
          volume: Number(o1.acml_vol),
          trading_value: Number(o1.acml_tr_pbmn),
          advances: Number(o1.ascn_issu_cnt),
          unchanged: Number(o1.stnr_issu_cnt),
          declines: Number(o1.down_issu_cnt),
          limit_up: Number(o1.uplm_issu_cnt),
          limit_down: Number(o1.lslm_issu_cnt),
        },
        rows,
      }, meta));
    }
  );

  // ── market_get_sector ──────────────────────────────────────────────────────

  server.registerTool(
    "market_get_sector",
    {
      title: "업종 지수 시세 조회",
      description:
        "KIS 업종코드로 국내 업종 지수의 현재 스냅샷과 OHLCV 가격 이력을 조회합니다. 예: 0001=KOSPI종합, 1001=KOSDAQ.",
      inputSchema: {
        sector_code: z.string().min(1).describe("업종코드 (예: 0001=KOSPI종합, 1001=KOSDAQ, 0002=대형주)"),
        period: z.enum(["D", "W", "M", "Y"]).default("D"),
        start_date: z.string().optional().describe("YYYYMMDD"),
        end_date: z.string().optional().describe("YYYYMMDD, 기본: 오늘"),
        limit: z.number().int().positive().max(50).default(30),
      },
      outputSchema: envelopeOutputSchema,
      annotations: READ_ONLY,
    },
    async ({ sector_code, period, start_date, end_date, limit }) => {
      const today = new Date().toISOString().slice(0, 10).replace(/-/g, "");
      const endDate = (end_date ?? today).replace(/-/g, "");
      const startDate = (start_date ?? endDate).replace(/-/g, "");

      type SectorBody = {
        output1: {
          hts_kor_isnm: string; bstp_nmix_prpr: string; bstp_nmix_prdy_ctrt: string;
          prdy_vrss_sign: string; bstp_nmix_oprc: string; bstp_nmix_hgpr: string;
          bstp_nmix_lwpr: string; acml_vol: string; acml_tr_pbmn: string; bstp_cls_code: string;
        };
        output2: Array<{
          stck_bsop_date: string; bstp_nmix_prpr: string; bstp_nmix_oprc: string;
          bstp_nmix_hgpr: string; bstp_nmix_lwpr: string; acml_vol: string;
          acml_tr_pbmn: string; mod_yn: string;
        }>;
      };
      const cacheKey = `FHKUP03500100:${sector_code}:${period}:${startDate}:${endDate}`;
      const cacheHit = kisGetCached<SectorBody>(cacheKey);

      let body: SectorBody;
      try {
        body = cacheHit?.data ?? await kisGet<SectorBody>(
          "/uapi/domestic-stock/v1/quotations/inquire-daily-indexchartprice",
          "FHKUP03500100",
          {
            fid_cond_mrkt_div_code: "U",
            fid_input_iscd: sector_code,
            fid_input_date_1: startDate,
            fid_input_date_2: endDate,
            fid_period_div_code: period,
          },
          cfg
        );
        if (!cacheHit) kisSetCached(cacheKey, body);
      } catch (err) {
        return jsonToolResponse(kisToolError(err, "inquire-daily-indexchartprice"), true);
      }

      const o1 = body.output1;
      const rows = (body.output2 ?? []).slice(0, limit).map((r) => ({
        date: r.stck_bsop_date,
        close: Number(r.bstp_nmix_prpr),
        open: Number(r.bstp_nmix_oprc),
        high: Number(r.bstp_nmix_hgpr),
        low: Number(r.bstp_nmix_lwpr),
        volume: Number(r.acml_vol),
        trading_value: Number(r.acml_tr_pbmn),
        is_adjusted: r.mod_yn === "Y",
      }));

      const meta = cacheHit
        ? { ...createMeta("CACHE", "inquire-daily-indexchartprice"), as_of: cacheHit.as_of, cached: true, cache_ttl_sec: CACHE_TTL_SEC }
        : createMeta("KIS", "inquire-daily-indexchartprice");
      return jsonToolResponse(successEnvelope({
        sector_code,
        sector_name: o1.hts_kor_isnm,
        period,
        snapshot: {
          price: Number(o1.bstp_nmix_prpr),
          change_rate: Number(o1.bstp_nmix_prdy_ctrt),
          change_sign: o1.prdy_vrss_sign,
          open: Number(o1.bstp_nmix_oprc),
          high: Number(o1.bstp_nmix_hgpr),
          low: Number(o1.bstp_nmix_lwpr),
          volume: Number(o1.acml_vol),
          trading_value: Number(o1.acml_tr_pbmn),
        },
        rows,
      }, meta));
    }
  );

  // ── market_get_news ────────────────────────────────────────────────────────

  server.registerTool(
    "market_get_news",
    {
      title: "시장 뉴스 조회",
      description:
        "국내 주식 시장 뉴스와 공시성 제목을 조회합니다. 종목코드를 지정하면 해당 종목 관련 항목만 반환합니다.",
      inputSchema: {
        stock_code: z.string().optional().describe("종목코드 6자리 (미입력 시 전체 시장 뉴스)"),
        date: z.string().optional().describe("조회 기준 날짜 YYYYMMDD (기본: 현재)"),
        time: z.string().optional().describe("조회 기준 시간 HHMMSS (기본: 현재)"),
        limit: z.number().int().positive().max(200).default(20),
      },
      outputSchema: envelopeOutputSchema,
      annotations: READ_ONLY,
    },
    async ({ stock_code, date, time, limit }) => {
      const fid_date = date ? `00${date.replace(/-/g, "")}` : "";
      const fid_time = time ? `0000${time.replace(/:/g, "")}` : "";

      type NewsBody = {
        output: Array<{
          cntt_usiq_srno: string;
          news_ofer_entp_code: string;
          data_dt: string;
          data_tm: string;
          hts_pbnt_titl_cntt: string;
          news_lrdv_code: string;
        }>;
      };
      const cacheKey = `FHKST01011800:${stock_code ?? ""}:${fid_date}:${fid_time}`;
      const cacheHit = kisGetCached<NewsBody>(cacheKey);

      let body: NewsBody;
      try {
        body = cacheHit?.data ?? await kisGet<NewsBody>(
          "/uapi/domestic-stock/v1/quotations/news-title",
          "FHKST01011800",
          {
            fid_news_ofer_entp_code: "",
            fid_cond_mrkt_cls_code: "",
            fid_input_iscd: stock_code ?? "",
            fid_titl_cntt: "",
            fid_input_date_1: fid_date,
            fid_input_hour_1: fid_time,
            fid_rank_sort_cls_code: "",
            fid_input_srno: "",
          },
          cfg
        );
        if (!cacheHit) kisSetCached(cacheKey, body);
      } catch (err) {
        return jsonToolResponse(kisToolError(err, "news-title"), true);
      }

      const items = (body.output ?? []).slice(0, limit).map((r) => ({
        id: r.cntt_usiq_srno,
        provider: r.news_ofer_entp_code,
        date: r.data_dt,
        time: r.data_tm,
        title: r.hts_pbnt_titl_cntt,
        category: r.news_lrdv_code,
      }));

      const meta = cacheHit
        ? { ...createMeta("CACHE", "news-title"), as_of: cacheHit.as_of, cached: true, cache_ttl_sec: CACHE_TTL_SEC }
        : createMeta("KIS", "news-title");
      return jsonToolResponse(successEnvelope({ stock_code: stock_code ?? null, items }, meta));
    }
  );

  // ── market_get_movers ──────────────────────────────────────────────────────

  server.registerTool(
    "market_get_movers",
    {
      title: "시장 순위 조회",
      description:
        "거래량, 등락률, 시가총액, 거래대금 기준으로 국내 주식 시장 순위를 조회합니다. 최대 30건을 반환합니다.",
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
