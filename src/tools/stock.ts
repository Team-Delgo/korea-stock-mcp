import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
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

interface MasterRecord {
  stock_code: string;
  name: string;
  market: string;
  market_cap: number;
}

let _master: MasterRecord[] | null = null;

function getMaster(): MasterRecord[] {
  if (!_master) {
    const p = fileURLToPath(new URL("../../data/stock_data_ko.json", import.meta.url));
    const raw: Array<{ code: string; name: string; market: string; marketCap: number }> =
      JSON.parse(readFileSync(p, "utf-8"));
    _master = raw.map((r) => ({
      stock_code: r.code,
      name: r.name,
      market: r.market,
      market_cap: r.marketCap,
    }));
  }
  return _master;
}

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

export function registerStockTools(server: McpServer, cfg: AppConfig) {
  // ── resolve_stock ──────────────────────────────────────────────────────────

  server.registerTool(
    "resolve_stock",
    {
      title: "Resolve Stock",
      description: "Resolve a Korean stock name or code to KIS stock_code. corp_code is null until DART integration.",
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
      const q = query.trim();
      const pool = market === "ALL" ? records : records.filter((r) => r.market === market);

      const exactCode = pool.find((r) => r.stock_code === q);
      if (exactCode) {
        return jsonToolResponse(
          successEnvelope(
            { matches: [{ stock_code: exactCode.stock_code, name: exactCode.name, market: exactCode.market, corp_code: null }] },
            createMeta("KIS", "stock-master-local")
          )
        );
      }

      const lower = q.toLowerCase();
      const matches = pool
        .filter((r) => r.name.toLowerCase().includes(lower))
        .slice(0, limit)
        .map((r) => ({ stock_code: r.stock_code, name: r.name, market: r.market, corp_code: null }));

      if (matches.length === 0) {
        return jsonToolResponse(
          { ok: false, error: { code: "NO_DATA", message: `No stock found for: ${q}` }, meta: createMeta("KIS", "stock-master-local") },
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
      title: "Get Stock Master",
      description: "List all Korean listed stock master records from local KIS data.",
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
      title: "Get Stock Quote",
      description: "Get a current quote for a Korean stock through KIS.",
      inputSchema: {
        stock_code: z.string().regex(/^\d{6}$/),
        market_div_code: z.string().default("J"),
        include_extended: z.boolean().default(true),
      },
      outputSchema: envelopeOutputSchema,
      annotations: READ_ONLY,
    },
    async ({ stock_code, market_div_code }) => {
      try {
        const body = await kisGet<{
          output: {
            stck_prpr: string;
            prdy_vrss: string;
            prdy_vrss_sign: string;
            prdy_ctrt: string;
            acml_vol: string;
            acml_tr_pbmn: string;
            stck_oprc: string;
            stck_hgpr: string;
            stck_lwpr: string;
            hts_avls: string;
            per: string;
            pbr: string;
            w52_hgpr: string;
            w52_lwpr: string;
            rprs_mrkt_kor_name: string;
            bstp_kor_isnm: string;
          };
        }>(
          "/uapi/domestic-stock/v1/quotations/inquire-price",
          "FHKST01010100",
          { fid_cond_mrkt_div_code: market_div_code, fid_input_iscd: stock_code },
          cfg
        );

        const o = body.output;
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
            createMeta("KIS", "inquire-price")
          )
        );
      } catch (err) {
        return jsonToolResponse(kisToolError(err, "inquire-price"), true);
      }
    }
  );

  // ── stock_get_orderbook ────────────────────────────────────────────────────

  server.registerTool(
    "stock_get_orderbook",
    {
      title: "Get Stock Orderbook",
      description: "Get bid/ask orderbook and expected execution data for a stock.",
      inputSchema: {
        stock_code: z.string().regex(/^\d{6}$/),
        market_div_code: z.string().default("J"),
        depth: z.number().int().positive().max(10).default(10),
      },
      outputSchema: envelopeOutputSchema,
      annotations: READ_ONLY,
    },
    async ({ stock_code, market_div_code, depth }) => {
      try {
        const body = await kisGet<{
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
        }>(
          "/uapi/domestic-stock/v1/quotations/inquire-asking-price-exp-ccn",
          "FHKST01010200",
          { fid_cond_mrkt_div_code: market_div_code, fid_input_iscd: stock_code },
          cfg
        );

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
          .filter(a => a.price > 0);
        const bids = bidLevels.slice(0, n)
          .map(({ p, q }) => ({ price: Number(p), quantity: Number(q) }))
          .filter(b => b.price > 0);

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
            createMeta("KIS", "inquire-asking-price-exp-ccn")
          )
        );
      } catch (err) {
        return jsonToolResponse(kisToolError(err, "inquire-asking-price-exp-ccn"), true);
      }
    }
  );

  // ── stock_get_price_history ────────────────────────────────────────────────

  server.registerTool(
    "stock_get_price_history",
    {
      title: "Get Stock Price History",
      description:
        "Get daily, weekly, monthly, or yearly OHLCV history for a stock. Max 100 records per request (KIS API limit).",
      inputSchema: {
        stock_code: z.string().regex(/^\d{6}$/),
        period: z.enum(["D", "W", "M", "Y"]).default("D"),
        start_date: z.string().optional(),
        end_date: z.string().optional(),
        adjusted: z.boolean().default(true),
        limit: z.number().int().positive().max(100).default(100),
      },
      outputSchema: envelopeOutputSchema,
      annotations: READ_ONLY,
    },
    async ({ stock_code, period, start_date, end_date, adjusted, limit }) => {
      try {
        const today = new Date().toISOString().slice(0, 10).replace(/-/g, "");
        const endDate = (end_date ?? today).replace(/-/g, "");
        const startDate = (start_date ?? endDate).replace(/-/g, "");

        const body = await kisGet<{
          output2: Array<{
            stck_bsop_date: string;
            stck_clpr: string;
            stck_oprc: string;
            stck_hgpr: string;
            stck_lwpr: string;
            acml_vol: string;
            acml_tr_pbmn: string;
            prdy_vrss: string;
            prdy_vrss_sign: string;
            mod_yn: string;
          }>;
        }>(
          "/uapi/domestic-stock/v1/quotations/inquire-daily-itemchartprice",
          "FHKST03010100",
          {
            fid_cond_mrkt_div_code: "J",
            fid_input_iscd: stock_code,
            fid_input_date_1: startDate,
            fid_input_date_2: endDate,
            fid_period_div_code: period,
            fid_org_adj_prc: adjusted ? "0" : "1",
          },
          cfg
        );

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

        return jsonToolResponse(
          successEnvelope(
            { stock_code, period, rows },
            createMeta("KIS", "inquire-daily-itemchartprice")
          )
        );
      } catch (err) {
        return jsonToolResponse(kisToolError(err, "inquire-daily-itemchartprice"), true);
      }
    }
  );
}
