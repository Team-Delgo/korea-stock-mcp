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
import { getMaster, searchStocks, type MasterRecord } from "../utils/stock-resolver.js";
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
 * Resolves a name/code query to a single stock code for KIS API calls.
 * Returns the code string on success, or a ready-to-return tool response on failure.
 */
function resolveKisCode(input: string): { stock_code: string } | ReturnType<typeof jsonToolResponse> {
  const matches = searchStocks(input, getMaster());
  const meta = createMeta("KIS", "stock-master-local");
  if (matches.length === 0) {
    return jsonToolResponse(
      { ok: false, error: { code: "NO_DATA", message: `종목을 찾을 수 없습니다: ${input}` }, meta },
      true
    );
  }
  if (matches.length > 1) {
    return jsonToolResponse(
      {
        ok: false,
        error: {
          code: "AMBIGUOUS",
          message: `'${input}'에 해당하는 종목이 여러 개입니다. stock_code(6자리)로 다시 시도해주세요.`,
          candidates: matches.map((r: MasterRecord) => ({ stock_code: r.stock_code, name: r.name })),
        },
        meta,
      },
      true
    );
  }
  return { stock_code: matches[0].stock_code };
}

export function registerStockTools(server: McpServer, cfg: AppConfig) {
  // ── resolve_stock ──────────────────────────────────────────────────────────

  server.registerTool(
    "resolve_stock",
    {
      title: "종목 검색",
      description: "종목명, 영문명, 초성, 약칭, 6자리 종목코드로 국내 상장 종목을 검색합니다.",
      inputSchema: {
        query: z.string().min(1),
        market: z.enum(["KOSPI", "KOSDAQ", "KONEX", "ALL"]).default("ALL"),
        limit: z.number().int().positive().max(50).default(10),
      },
      outputSchema: envelopeOutputSchema,
      annotations: READ_ONLY,
    },
    async ({ query, market, limit }) => {
      const records = getMaster();
      const pool = market === "ALL" ? records : records.filter((r) => r.market === market);
      const matches = searchStocks(query.trim(), pool)
        .slice(0, limit)
        .map((r) => ({ stock_code: r.stock_code, name: r.name, market: r.market, corp_code: null }));

      if (matches.length === 0) {
        return jsonToolResponse(
          { ok: false, error: { code: "NO_DATA", message: `No stock found for: ${query.trim()}` }, meta: createMeta("KIS", "stock-master-local") },
          true
        );
      }

      return jsonToolResponse(
        successEnvelope({ matches }, createMeta("KIS", "stock-master-local"))
      );
    }
  );

  // ── get_stock_master ───────────────────────────────────────────────────────

  server.registerTool(
    "get_stock_master",
    {
      title: "종목 마스터 조회",
      description: "로컬 종목 마스터에서 국내 상장 종목 목록과 기본 정보를 조회합니다.",
      inputSchema: {
        market: z.enum(["KOSPI", "KOSDAQ", "KONEX", "ALL"]).default("ALL"),
        include_delisted: z.boolean().default(false),
        updated_after: z.string().optional(),
      },
      outputSchema: envelopeOutputSchema,
      annotations: READ_ONLY,
    },
    async ({ market }) => {
      const records = getMaster();
      const filtered = market === "ALL" ? records : records.filter((r) => r.market === market);
      return jsonToolResponse(
        successEnvelope(
          { total: filtered.length, records: filtered },
          createMeta("KIS", "stock-master-local")
        )
      );
    }
  );

  // ── stock_get_quote ────────────────────────────────────────────────────────

  server.registerTool(
    "stock_get_quote",
    {
      title: "주식 현재가 조회",
      description: "종목명 또는 6자리 종목코드로 국내 주식 현재가, 등락률, 거래량, 시가총액 등 시세 정보를 조회합니다.",
      inputSchema: {
        stock_code: z.string().min(1).describe("6자리 종목코드 또는 종목명 (예: 005930, 삼성전자, ㅅㅅㅈㅈ, 삼전)"),
        market_div_code: z.string().default("J"),
        include_extended: z.boolean().default(true),
      },
      outputSchema: envelopeOutputSchema,
      annotations: READ_ONLY,
    },
    async ({ stock_code: input, market_div_code }) => {
      const resolved = resolveKisCode(input);
      if (!("stock_code" in resolved)) return resolved;
      const stock_code = resolved.stock_code;

      type QuoteBody = {
        output: {
          stck_prpr: string; prdy_vrss: string; prdy_vrss_sign: string; prdy_ctrt: string;
          acml_vol: string; acml_tr_pbmn: string; stck_oprc: string; stck_hgpr: string;
          stck_lwpr: string; hts_avls: string; per: string; pbr: string;
          w52_hgpr: string; w52_lwpr: string; rprs_mrkt_kor_name: string; bstp_kor_isnm: string;
        };
      };
      const cacheKey = `FHKST01010100:${stock_code}:${market_div_code}`;
      const cacheHit = kisGetCached<QuoteBody>(cacheKey);

      let body: QuoteBody;
      try {
        body = cacheHit?.data ?? await kisGet<QuoteBody>(
          "/uapi/domestic-stock/v1/quotations/inquire-price",
          "FHKST01010100",
          { fid_cond_mrkt_div_code: market_div_code, fid_input_iscd: stock_code },
          cfg
        );
        if (!cacheHit) kisSetCached(cacheKey, body);
      } catch (err) {
        return jsonToolResponse(kisToolError(err, "inquire-price"), true);
      }

      const o = body.output;
      const meta = cacheHit
        ? { ...createMeta("CACHE", "inquire-price"), as_of: cacheHit.as_of, cached: true, cache_ttl_sec: CACHE_TTL_SEC }
        : createMeta("KIS", "inquire-price");
      return jsonToolResponse(
        successEnvelope(
          {
            stock_code,
            price: Number(o.stck_prpr),
            change: Number(o.prdy_vrss),
            change_sign: o.prdy_vrss_sign,
            change_rate: Number(o.prdy_ctrt),
            volume: Number(o.acml_vol),
            trading_value: Number(o.acml_tr_pbmn),
            open: Number(o.stck_oprc),
            high: Number(o.stck_hgpr),
            low: Number(o.stck_lwpr),
            market_cap: Number(o.hts_avls),
            per: Number(o.per),
            pbr: Number(o.pbr),
            week52_high: Number(o.w52_hgpr),
            week52_low: Number(o.w52_lwpr),
            market: o.rprs_mrkt_kor_name,
            sector: o.bstp_kor_isnm,
          },
          meta
        )
      );
    }
  );

  // ── stock_get_orderbook ────────────────────────────────────────────────────

  server.registerTool(
    "stock_get_orderbook",
    {
      title: "주식 호가 조회",
      description: "종목명 또는 6자리 종목코드로 매도/매수 호가와 예상체결 정보를 조회합니다.",
      inputSchema: {
        stock_code: z.string().min(1).describe("6자리 종목코드 또는 종목명"),
        market_div_code: z.string().default("J"),
        depth: z.number().int().positive().max(10).default(10),
      },
      outputSchema: envelopeOutputSchema,
      annotations: READ_ONLY,
    },
    async ({ stock_code: input, market_div_code, depth }) => {
      const resolved = resolveKisCode(input);
      if (!("stock_code" in resolved)) return resolved;
      const stock_code = resolved.stock_code;

      type OrderbookBody = {
        output1: {
          aspr_acpt_hour: string;
          askp1: string; askp2: string; askp3: string; askp4: string; askp5: string;
          askp6: string; askp7: string; askp8: string; askp9: string; askp10: string;
          bidp1: string; bidp2: string; bidp3: string; bidp4: string; bidp5: string;
          bidp6: string; bidp7: string; bidp8: string; bidp9: string; bidp10: string;
          askp_rsqn1: string; askp_rsqn2: string; askp_rsqn3: string; askp_rsqn4: string; askp_rsqn5: string;
          askp_rsqn6: string; askp_rsqn7: string; askp_rsqn8: string; askp_rsqn9: string; askp_rsqn10: string;
          bidp_rsqn1: string; bidp_rsqn2: string; bidp_rsqn3: string; bidp_rsqn4: string; bidp_rsqn5: string;
          bidp_rsqn6: string; bidp_rsqn7: string; bidp_rsqn8: string; bidp_rsqn9: string; bidp_rsqn10: string;
          total_askp_rsqn: string;
          total_bidp_rsqn: string;
        };
        output2: {
          antc_cnpr: string;
          antc_vol: string;
        };
      };
      const cacheKey = `FHKST01010200:${stock_code}:${market_div_code}`;
      const cacheHit = kisGetCached<OrderbookBody>(cacheKey);

      let body: OrderbookBody;
      try {
        body = cacheHit?.data ?? await kisGet<OrderbookBody>(
          "/uapi/domestic-stock/v1/quotations/inquire-asking-price-exp-ccn",
          "FHKST01010200",
          { fid_cond_mrkt_div_code: market_div_code, fid_input_iscd: stock_code },
          cfg
        );
        if (!cacheHit) kisSetCached(cacheKey, body);
      } catch (err) {
        return jsonToolResponse(kisToolError(err, "inquire-asking-price-exp-ccn"), true);
      }

      const o1 = body.output1;
      const o2 = body.output2;
      const n = Math.min(depth, 10);

      const askLevels = [
        { p: o1.askp1, q: o1.askp_rsqn1 }, { p: o1.askp2, q: o1.askp_rsqn2 },
        { p: o1.askp3, q: o1.askp_rsqn3 }, { p: o1.askp4, q: o1.askp_rsqn4 },
        { p: o1.askp5, q: o1.askp_rsqn5 }, { p: o1.askp6, q: o1.askp_rsqn6 },
        { p: o1.askp7, q: o1.askp_rsqn7 }, { p: o1.askp8, q: o1.askp_rsqn8 },
        { p: o1.askp9, q: o1.askp_rsqn9 }, { p: o1.askp10, q: o1.askp_rsqn10 },
      ];
      const bidLevels = [
        { p: o1.bidp1, q: o1.bidp_rsqn1 }, { p: o1.bidp2, q: o1.bidp_rsqn2 },
        { p: o1.bidp3, q: o1.bidp_rsqn3 }, { p: o1.bidp4, q: o1.bidp_rsqn4 },
        { p: o1.bidp5, q: o1.bidp_rsqn5 }, { p: o1.bidp6, q: o1.bidp_rsqn6 },
        { p: o1.bidp7, q: o1.bidp_rsqn7 }, { p: o1.bidp8, q: o1.bidp_rsqn8 },
        { p: o1.bidp9, q: o1.bidp_rsqn9 }, { p: o1.bidp10, q: o1.bidp_rsqn10 },
      ];

      const asks = askLevels.slice(0, n)
        .map(({ p, q }) => ({ price: Number(p), quantity: Number(q) }))
        .filter((a) => a.price > 0);
      const bids = bidLevels.slice(0, n)
        .map(({ p, q }) => ({ price: Number(p), quantity: Number(q) }))
        .filter((b) => b.price > 0);

      const meta = cacheHit
        ? { ...createMeta("CACHE", "inquire-asking-price-exp-ccn"), as_of: cacheHit.as_of, cached: true, cache_ttl_sec: CACHE_TTL_SEC }
        : createMeta("KIS", "inquire-asking-price-exp-ccn");
      return jsonToolResponse(
        successEnvelope(
          {
            stock_code,
            timestamp: o1.aspr_acpt_hour,
            asks,
            bids,
            total_ask_qty: Number(o1.total_askp_rsqn),
            total_bid_qty: Number(o1.total_bidp_rsqn),
            expected_price: Number(o2.antc_cnpr),
            expected_volume: Number(o2.antc_vol),
          },
          meta
        )
      );
    }
  );

  // ── stock_get_price_history ────────────────────────────────────────────────

  server.registerTool(
    "stock_get_price_history",
    {
      title: "주식 기간별 시세 조회",
      description:
        "종목명 또는 6자리 종목코드로 일/주/월/년 단위 OHLCV 가격 이력을 조회합니다. 한 번에 최대 100건을 반환합니다.",
      inputSchema: {
        stock_code: z.string().min(1).describe("6자리 종목코드 또는 종목명"),
        period: z.enum(["D", "W", "M", "Y"]).default("D"),
        start_date: z.string().optional(),
        end_date: z.string().optional(),
        adjusted: z.boolean().default(true),
        limit: z.number().int().positive().max(100).default(100),
      },
      outputSchema: envelopeOutputSchema,
      annotations: READ_ONLY,
    },
    async ({ stock_code: input, period, start_date, end_date, adjusted, limit }) => {
      const resolved = resolveKisCode(input);
      if (!("stock_code" in resolved)) return resolved;
      const stock_code = resolved.stock_code;

      const today = new Date().toISOString().slice(0, 10).replace(/-/g, "");
      const endDate = (end_date ?? today).replace(/-/g, "");
      const startDate = (start_date ?? endDate).replace(/-/g, "");
      const adjCode = adjusted ? "0" : "1";

      type HistoryBody = {
        output2: Array<{
          stck_bsop_date: string; stck_clpr: string; stck_oprc: string;
          stck_hgpr: string; stck_lwpr: string; acml_vol: string; acml_tr_pbmn: string;
          prdy_vrss: string; prdy_vrss_sign: string; mod_yn: string;
        }>;
      };
      const cacheKey = `FHKST03010100:${stock_code}:${period}:${startDate}:${endDate}:${adjCode}`;
      const cacheHit = kisGetCached<HistoryBody>(cacheKey);

      let body: HistoryBody;
      try {
        body = cacheHit?.data ?? await kisGet<HistoryBody>(
          "/uapi/domestic-stock/v1/quotations/inquire-daily-itemchartprice",
          "FHKST03010100",
          {
            fid_cond_mrkt_div_code: "J",
            fid_input_iscd: stock_code,
            fid_input_date_1: startDate,
            fid_input_date_2: endDate,
            fid_period_div_code: period,
            fid_org_adj_prc: adjCode,
          },
          cfg
        );
        if (!cacheHit) kisSetCached(cacheKey, body);
      } catch (err) {
        return jsonToolResponse(kisToolError(err, "inquire-daily-itemchartprice"), true);
      }

      const rows = (body.output2 ?? []).slice(0, limit).map((r) => ({
        date: r.stck_bsop_date,
        open: Number(r.stck_oprc),
        high: Number(r.stck_hgpr),
        low: Number(r.stck_lwpr),
        close: Number(r.stck_clpr),
        volume: Number(r.acml_vol),
        trading_value: Number(r.acml_tr_pbmn),
        change: Number(r.prdy_vrss),
        change_sign: r.prdy_vrss_sign,
        is_adjusted: r.mod_yn === "Y",
      }));

      if (rows.length === 0) {
        return jsonToolResponse(
          {
            ok: false,
            error: { code: "NO_DATA", message: "No price history found for the given range" },
            meta: createMeta("KIS", "inquire-daily-itemchartprice"),
          },
          true
        );
      }

      const meta = cacheHit
        ? { ...createMeta("CACHE", "inquire-daily-itemchartprice"), as_of: cacheHit.as_of, cached: true, cache_ttl_sec: CACHE_TTL_SEC }
        : createMeta("KIS", "inquire-daily-itemchartprice");
      return jsonToolResponse(
        successEnvelope({ stock_code, period, rows }, meta)
      );
    }
  );
}
