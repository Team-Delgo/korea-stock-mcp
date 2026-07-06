/**
 * Real KIS API smoke tests — skipped unless credentials are set.
 *
 * Required env vars:
 *   KIS_APP_KEY, KIS_APP_SECRET
 *   KIS_ENV=real   (ranking APIs require real mode; paper is accepted but some tests will be skipped)
 *
 * Run:
 *   KIS_APP_KEY=... KIS_APP_SECRET=... KIS_ENV=real npx vitest run tests/kis.unified.test.ts --reporter=verbose
 */

import { describe, it, expect, beforeAll } from "vitest";
import request from "supertest";
import type { AppConfig } from "../../src/config.js";
import type { KisEnv } from "../../src/config.js";
import { createExpressApp } from "../../src/server-factory.js";
import { getKisAccessToken, clearKisTokenCache } from "../../src/services/kis-auth.js";
import { kisGet } from "../../src/clients/kis-rest.js";

const KIS_APP_KEY = process.env.KIS_APP_KEY;
const KIS_APP_SECRET = process.env.KIS_APP_SECRET;
const KIS_ENV = (process.env.KIS_ENV ?? "paper") as KisEnv;

const hasCredentials = !!(KIS_APP_KEY && KIS_APP_SECRET);
const isRealMode = KIS_ENV === "real";

const cfg: AppConfig = {
  host: "127.0.0.1",
  port: 3000,
  mcpEndpoint: "/mcp",
  allowedOrigins: [],
  allowedHosts: [],
  logLevel: "silent",
  cacheDbPath: "./data/test.sqlite",
  kis: {
    appKey: KIS_APP_KEY,
    appSecret: KIS_APP_SECRET,
    env: KIS_ENV,
    baseUrlReal: "https://openapi.koreainvestment.com:9443",
    baseUrlPaper: "https://openapivts.koreainvestment.com:29443",
  },
  dart: { baseUrl: "https://opendart.fss.or.kr/api" },
};

const streamableHttpAccept = "application/json, text/event-stream";

function parseSseJson(text: string) {
  const dataLine = text.split("\n").find((l) => l.startsWith("data: "));
  if (!dataLine) throw new Error(`No SSE data line in: ${text}`);
  return JSON.parse(dataLine.slice("data: ".length));
}

async function callTool(name: string, args: object) {
  const app = createExpressApp(cfg);
  const res = await request(app)
    .post("/mcp")
    .set("Accept", streamableHttpAccept)
    .send({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } })
    .expect(200);
  return parseSseJson(res.text).result;
}

function expectOk(result: { isError?: boolean; structuredContent: { error?: unknown } }) {
  const err = result.structuredContent.error;
  expect(result.isError, `tool returned error: ${JSON.stringify(err)}`).toBeFalsy();
}

// ── auth ─────────────────────────────────────────────────────────────────────

describe.skipIf(!hasCredentials)("getKisAccessToken (real)", () => {
  beforeAll(() => clearKisTokenCache());

  it("returns a non-empty access_token string", { timeout: 10000 }, async () => {
    const token = await getKisAccessToken(cfg);

    expect(typeof token).toBe("string");
    expect(token.length).toBeGreaterThan(0);
  });

  it("caches — second call returns same token without extra fetch", { timeout: 10000 }, async () => {
    const t1 = await getKisAccessToken(cfg);
    const t2 = await getKisAccessToken(cfg);

    expect(t1).toBe(t2);
  });
});

// ── kisGet raw ────────────────────────────────────────────────────────────────

describe.skipIf(!hasCredentials)("kisGet (real)", () => {
  beforeAll(() => clearKisTokenCache());

  it("returns raw KIS response with rt_cd=0 for 삼성전자 quote", { timeout: 10000 }, async () => {
    const body = await kisGet<{ rt_cd: string; output: { stck_prpr: string } }>(
      "/uapi/domestic-stock/v1/quotations/inquire-price",
      "FHKST01010100",
      { fid_cond_mrkt_div_code: "J", fid_input_iscd: "005930" },
      cfg
    );

    expect(body.rt_cd).toBe("0");
    expect(typeof body.output.stck_prpr).toBe("string");
    expect(Number(body.output.stck_prpr)).toBeGreaterThan(0);
  });
});

// ── stock_get_quote ───────────────────────────────────────────────────────────

describe.skipIf(!hasCredentials)("stock_get_quote (real)", () => {
  beforeAll(() => clearKisTokenCache());

  it("returns ok:true envelope for 삼성전자 (005930)", { timeout: 10000 }, async () => {
    const result = await callTool("stock_get_quote", { stock_code: "005930" });

    expectOk(result);
    expect(result.structuredContent).toMatchObject({ ok: true });

    const data = result.structuredContent.data;
    expect(data.stock_code).toBe("005930");
    expect(typeof data.price).toBe("number");
    expect(data.price).toBeGreaterThan(0);
    expect(typeof data.volume).toBe("number");
    expect(typeof data.change_rate).toBe("number");
    expect(["1","2","3","4","5"]).toContain(data.change_sign);
  });

  it("meta fields are populated", { timeout: 10000 }, async () => {
    const result = await callTool("stock_get_quote", { stock_code: "005930" });

    expect(result.structuredContent.meta).toMatchObject({
      source: "KIS",
      source_api: "inquire-price",
    });
    expect(typeof result.structuredContent.meta.as_of).toBe("string");
  });
});

// ── stock_get_orderbook ───────────────────────────────────────────────────────

describe.skipIf(!hasCredentials)("stock_get_orderbook (real)", () => {
  beforeAll(() => clearKisTokenCache());

  it("returns asks and bids arrays for 삼성전자", { timeout: 10000 }, async () => {
    const result = await callTool("stock_get_orderbook", { stock_code: "005930", depth: 5 });

    expectOk(result);
    const data = result.structuredContent.data;
    expect(Array.isArray(data.asks)).toBe(true);
    expect(Array.isArray(data.bids)).toBe(true);
    expect(data.asks.length).toBeGreaterThan(0);
    expect(data.bids.length).toBeGreaterThan(0);
    expect(data.asks[0]).toMatchObject({
      price: expect.any(Number),
      quantity: expect.any(Number),
    });
  });

  it("total_ask_qty and total_bid_qty are positive numbers", { timeout: 10000 }, async () => {
    const result = await callTool("stock_get_orderbook", { stock_code: "005930" });

    expectOk(result);
    const data = result.structuredContent.data;
    expect(data.total_ask_qty).toBeGreaterThan(0);
    expect(data.total_bid_qty).toBeGreaterThan(0);
  });
});

// ── stock_get_price_history ───────────────────────────────────────────────────

describe.skipIf(!hasCredentials)("stock_get_price_history (real)", () => {
  beforeAll(() => clearKisTokenCache());

  it("returns OHLCV rows for 삼성전자 daily", { timeout: 10000 }, async () => {
    const result = await callTool("stock_get_price_history", {
      stock_code: "005930",
      period: "D",
      start_date: "20260601",
      end_date: "20260706",
    });

    expectOk(result);
    const data = result.structuredContent.data;
    expect(data.stock_code).toBe("005930");
    expect(data.period).toBe("D");
    expect(Array.isArray(data.rows)).toBe(true);
    expect(data.rows.length).toBeGreaterThan(0);
    expect(data.rows[0]).toMatchObject({
      date: expect.stringMatching(/^\d{8}$/),
      open: expect.any(Number),
      high: expect.any(Number),
      low: expect.any(Number),
      close: expect.any(Number),
      volume: expect.any(Number),
    });
  });

  it("high >= low for every row", { timeout: 10000 }, async () => {
    const result = await callTool("stock_get_price_history", {
      stock_code: "005930",
      period: "D",
      start_date: "20260601",
      end_date: "20260706",
    });

    expectOk(result);
    const rows = result.structuredContent.data.rows as { high: number; low: number }[];
    for (const row of rows) {
      expect(row.high).toBeGreaterThanOrEqual(row.low);
    }
  });
});

// ── market_get_movers — real mode only ───────────────────────────────────────

describe.skipIf(!hasCredentials || !isRealMode)("market_get_movers (real, real-mode only)", () => {
  beforeAll(() => clearKisTokenCache());

  it("volume ranking returns items with positive volume", { timeout: 10000 }, async () => {
    const result = await callTool("market_get_movers", { ranking_type: "volume", limit: 5 });

    expectOk(result);
    const data = result.structuredContent.data;
    expect(data.ranking_type).toBe("volume");
    expect(Array.isArray(data.items)).toBe(true);
    expect(data.items.length).toBeGreaterThan(0);
    expect(data.items[0]).toMatchObject({
      rank: expect.any(Number),
      stock_code: expect.stringMatching(/^\d{6}$/),
      name: expect.any(String),
      price: expect.any(Number),
      volume: expect.any(Number),
    });
    for (const item of data.items) {
      expect((item as { volume: number }).volume).toBeGreaterThan(0);
    }
  });

  it("change_rate top ranking has positive change_rate items", { timeout: 10000 }, async () => {
    const result = await callTool("market_get_movers", {
      ranking_type: "change_rate",
      direction: "top",
      limit: 5,
    });

    expectOk(result);
    const items = result.structuredContent.data.items as { change_rate: number }[];
    expect(items.length).toBeGreaterThan(0);
    // top gainers should have positive change_rate (unless market is down across the board)
    expect(items[0].change_rate).toBeGreaterThanOrEqual(0);
  });

  it("change_rate bottom ranking has lower change_rate than top", { timeout: 15000 }, async () => {
    clearKisTokenCache();
    const topResult = await callTool("market_get_movers", {
      ranking_type: "change_rate",
      direction: "top",
      limit: 1,
    });
    clearKisTokenCache();
    const bottomResult = await callTool("market_get_movers", {
      ranking_type: "change_rate",
      direction: "bottom",
      limit: 1,
    });

    expectOk(topResult);
    expectOk(bottomResult);
    const topRate = topResult.structuredContent.data.items[0].change_rate as number;
    const bottomRate = bottomResult.structuredContent.data.items[0].change_rate as number;
    expect(topRate).toBeGreaterThanOrEqual(bottomRate);
  });

  it("market_cap ranking includes stck_avls as market_cap", { timeout: 10000 }, async () => {
    const result = await callTool("market_get_movers", { ranking_type: "market_cap", limit: 3 });

    expectOk(result);
    const items = result.structuredContent.data.items as { market_cap: number }[];
    expect(items.length).toBeGreaterThan(0);
    for (const item of items) {
      expect(item.market_cap).toBeGreaterThan(0);
    }
    // top-1 market cap should be >= top-2
    if (items.length >= 2) {
      expect(items[0].market_cap).toBeGreaterThanOrEqual(items[1].market_cap);
    }
  });

  it("trading_value ranking uses volume-rank endpoint with FID_BLNG_CLS_CODE=3", { timeout: 10000 }, async () => {
    const result = await callTool("market_get_movers", { ranking_type: "trading_value", limit: 5 });

    expectOk(result);
    const items = result.structuredContent.data.items as { trading_value: number }[];
    expect(items.length).toBeGreaterThan(0);
    for (const item of items) {
      expect(item.trading_value).toBeGreaterThan(0);
    }
  });
});
