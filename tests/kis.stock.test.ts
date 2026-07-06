import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import type { AppConfig } from "../src/config.js";
import { createExpressApp } from "../src/server-factory.js";
import { clearKisTokenCache } from "../src/services/kis-auth.js";

const cfg: AppConfig = {
  host: "127.0.0.1",
  port: 3000,
  mcpEndpoint: "/mcp",
  allowedOrigins: [],
  allowedHosts: [],
  logLevel: "silent",
  cacheDbPath: "./data/test.sqlite",
  kis: {
    appKey: "test-app-key",
    appSecret: "test-app-secret",
    env: "paper",
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

function fakeTokenRes(token = "test-token") {
  return {
    ok: true,
    json: async () => ({ access_token: token, expires_in: 86400 }),
  } as unknown as Response;
}

function fakeKisBody(body: object) {
  return {
    ok: true,
    json: async () => ({ rt_cd: "0", msg1: "OK", ...body }),
  } as unknown as Response;
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

// ── stock_get_quote ──────────────────────────────────────────────────────────

describe("stock_get_quote", () => {
  beforeEach(() => {
    clearKisTokenCache();
    vi.unstubAllGlobals();
  });

  const fakeQuoteOutput = {
    stck_prpr: "75000",
    prdy_vrss: "1000",
    prdy_vrss_sign: "2",
    prdy_ctrt: "1.35",
    acml_vol: "12000000",
    acml_tr_pbmn: "900000000000",
    stck_oprc: "74000",
    stck_hgpr: "75500",
    stck_lwpr: "73500",
    hts_avls: "4474773",
    per: "19.67",
    pbr: "1.72",
    w52_hgpr: "88800",
    w52_lwpr: "59900",
    rprs_mrkt_kor_name: "KOSPI200",
    bstp_kor_isnm: "전자부품",
  };

  it("returns ok:true envelope with normalized numeric fields", async () => {
    vi.stubGlobal("fetch", vi.fn()
      .mockResolvedValueOnce(fakeTokenRes())
      .mockResolvedValueOnce(fakeKisBody({ output: fakeQuoteOutput }))
    );

    const result = await callTool("stock_get_quote", { stock_code: "005930" });

    expect(result.isError).toBeFalsy();
    expect(result.structuredContent).toMatchObject({
      ok: true,
      data: {
        stock_code: "005930",
        price: 75000,
        change: 1000,
        change_sign: "2",
        change_rate: 1.35,
        volume: 12000000,
        open: 74000,
        high: 75500,
        low: 73500,
        market_cap: 4474773,
        per: 19.67,
        pbr: 1.72,
        week52_high: 88800,
        week52_low: 59900,
        market: "KOSPI200",
        sector: "전자부품",
      },
    });
  });

  it("meta.source is KIS and source_api is inquire-price", async () => {
    vi.stubGlobal("fetch", vi.fn()
      .mockResolvedValueOnce(fakeTokenRes())
      .mockResolvedValueOnce(fakeKisBody({ output: fakeQuoteOutput }))
    );

    const result = await callTool("stock_get_quote", { stock_code: "005930" });

    expect(result.structuredContent.meta).toMatchObject({
      source: "KIS",
      source_api: "inquire-price",
    });
  });

  it("calls paper baseUrl (VHKST tr_id) in paper env", async () => {
    const mockFetch = vi.fn()
      .mockResolvedValueOnce(fakeTokenRes())
      .mockResolvedValueOnce(fakeKisBody({ output: fakeQuoteOutput }));
    vi.stubGlobal("fetch", mockFetch);

    await callTool("stock_get_quote", { stock_code: "005930" });

    const [apiUrl, opts] = mockFetch.mock.calls[1] as [string, RequestInit & { headers: Record<string, string> }];
    expect(apiUrl).toContain("openapivts.koreainvestment.com");
    expect(opts.headers["tr_id"]).toBe("VHKST01010100");
  });

  it("returns UPSTREAM_ERROR envelope on KIS rt_cd error", async () => {
    vi.stubGlobal("fetch", vi.fn()
      .mockResolvedValueOnce(fakeTokenRes())
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ rt_cd: "1", msg1: "종목코드 오류" }),
      } as unknown as Response)
    );

    const result = await callTool("stock_get_quote", { stock_code: "999999" });

    expect(result.isError).toBe(true);
    expect(result.structuredContent).toMatchObject({
      ok: false,
      error: { code: "UPSTREAM_ERROR", message: "종목코드 오류" },
    });
  });

  it("returns AUTH_EXPIRED envelope on HTTP 401", async () => {
    vi.stubGlobal("fetch", vi.fn()
      .mockResolvedValueOnce(fakeTokenRes())
      .mockResolvedValueOnce({ ok: false, status: 401 } as Response)
    );

    const result = await callTool("stock_get_quote", { stock_code: "005930" });

    expect(result.isError).toBe(true);
    expect(result.structuredContent).toMatchObject({
      ok: false,
      error: { code: "AUTH_EXPIRED" },
    });
  });

  it("returns RATE_LIMITED envelope on HTTP 429", async () => {
    vi.stubGlobal("fetch", vi.fn()
      .mockResolvedValueOnce(fakeTokenRes())
      .mockResolvedValueOnce({ ok: false, status: 429 } as Response)
    );

    const result = await callTool("stock_get_quote", { stock_code: "005930" });

    expect(result.isError).toBe(true);
    expect(result.structuredContent).toMatchObject({
      ok: false,
      error: { code: "RATE_LIMITED" },
    });
  });
});

// ── stock_get_orderbook ──────────────────────────────────────────────────────

describe("stock_get_orderbook", () => {
  beforeEach(() => {
    clearKisTokenCache();
    vi.unstubAllGlobals();
  });

  const fakeOutput1 = {
    aspr_acpt_hour: "143000",
    askp1: "75500", askp2: "76000", askp3: "76500", askp4: "77000", askp5: "77500",
    askp6: "78000", askp7: "78500", askp8: "79000", askp9: "79500", askp10: "80000",
    bidp1: "75000", bidp2: "74500", bidp3: "74000", bidp4: "73500", bidp5: "73000",
    bidp6: "72500", bidp7: "72000", bidp8: "71500", bidp9: "71000", bidp10: "70500",
    askp_rsqn1: "1000", askp_rsqn2: "2000", askp_rsqn3: "1500", askp_rsqn4: "3000", askp_rsqn5: "2500",
    askp_rsqn6: "1000", askp_rsqn7: "2000", askp_rsqn8: "1500", askp_rsqn9: "3000", askp_rsqn10: "2500",
    bidp_rsqn1: "2000", bidp_rsqn2: "3000", bidp_rsqn3: "2500", bidp_rsqn4: "1000", bidp_rsqn5: "1500",
    bidp_rsqn6: "2000", bidp_rsqn7: "3000", bidp_rsqn8: "2500", bidp_rsqn9: "1000", bidp_rsqn10: "1500",
    total_askp_rsqn: "20000",
    total_bidp_rsqn: "18000",
  };
  const fakeOutput2 = { antc_cnpr: "75200", antc_vol: "5000", stck_prpr: "75000" };

  it("returns asks/bids arrays with numeric price and quantity", async () => {
    vi.stubGlobal("fetch", vi.fn()
      .mockResolvedValueOnce(fakeTokenRes())
      .mockResolvedValueOnce(fakeKisBody({ output1: fakeOutput1, output2: fakeOutput2 }))
    );

    const result = await callTool("stock_get_orderbook", { stock_code: "005930" });

    expect(result.isError).toBeFalsy();
    const data = result.structuredContent.data as {
      asks: { price: number; quantity: number }[];
      bids: { price: number; quantity: number }[];
    };
    expect(data.asks).toHaveLength(10);
    expect(data.bids).toHaveLength(10);
    expect(data.asks[0]).toEqual({ price: 75500, quantity: 1000 });
    expect(data.bids[0]).toEqual({ price: 75000, quantity: 2000 });
  });

  it("depth param limits returned levels", async () => {
    vi.stubGlobal("fetch", vi.fn()
      .mockResolvedValueOnce(fakeTokenRes())
      .mockResolvedValueOnce(fakeKisBody({ output1: fakeOutput1, output2: fakeOutput2 }))
    );

    const result = await callTool("stock_get_orderbook", { stock_code: "005930", depth: 3 });

    const data = result.structuredContent.data as {
      asks: unknown[];
      bids: unknown[];
    };
    expect(data.asks).toHaveLength(3);
    expect(data.bids).toHaveLength(3);
  });

  it("returns expected_price and expected_volume from output2", async () => {
    vi.stubGlobal("fetch", vi.fn()
      .mockResolvedValueOnce(fakeTokenRes())
      .mockResolvedValueOnce(fakeKisBody({ output1: fakeOutput1, output2: fakeOutput2 }))
    );

    const result = await callTool("stock_get_orderbook", { stock_code: "005930" });

    expect(result.structuredContent.data).toMatchObject({
      expected_price: 75200,
      expected_volume: 5000,
      total_ask_qty: 20000,
      total_bid_qty: 18000,
      timestamp: "143000",
    });
  });

  it("filters out zero-price levels", async () => {
    const sparseOutput1 = {
      ...fakeOutput1,
      askp5: "0", askp_rsqn5: "0",
      bidp5: "0", bidp_rsqn5: "0",
    };
    vi.stubGlobal("fetch", vi.fn()
      .mockResolvedValueOnce(fakeTokenRes())
      .mockResolvedValueOnce(fakeKisBody({ output1: sparseOutput1, output2: fakeOutput2 }))
    );

    const result = await callTool("stock_get_orderbook", { stock_code: "005930" });

    const data = result.structuredContent.data as { asks: unknown[]; bids: unknown[] };
    expect(data.asks).toHaveLength(9);
    expect(data.bids).toHaveLength(9);
  });
});

// ── stock_get_price_history ──────────────────────────────────────────────────

describe("stock_get_price_history", () => {
  beforeEach(() => {
    clearKisTokenCache();
    vi.unstubAllGlobals();
  });

  const fakeOutput2 = [
    {
      stck_bsop_date: "20260706",
      stck_clpr: "75000", stck_oprc: "74000", stck_hgpr: "75500", stck_lwpr: "73500",
      acml_vol: "12000000", acml_tr_pbmn: "900000000000",
      prdy_vrss: "1000", prdy_vrss_sign: "2", mod_yn: "N",
    },
    {
      stck_bsop_date: "20260705",
      stck_clpr: "74000", stck_oprc: "73000", stck_hgpr: "74500", stck_lwpr: "72500",
      acml_vol: "9000000", acml_tr_pbmn: "660000000000",
      prdy_vrss: "-500", prdy_vrss_sign: "4", mod_yn: "N",
    },
  ];

  it("returns ok:true with rows array containing OHLCV", async () => {
    vi.stubGlobal("fetch", vi.fn()
      .mockResolvedValueOnce(fakeTokenRes())
      .mockResolvedValueOnce(fakeKisBody({ output1: {}, output2: fakeOutput2 }))
    );

    const result = await callTool("stock_get_price_history", {
      stock_code: "005930",
      start_date: "20260705",
      end_date: "20260706",
    });

    expect(result.isError).toBeFalsy();
    expect(result.structuredContent).toMatchObject({
      ok: true,
      data: { stock_code: "005930", period: "D", rows: expect.any(Array) },
    });
    const rows = result.structuredContent.data.rows as object[];
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      date: "20260706",
      open: 74000,
      high: 75500,
      low: 73500,
      close: 75000,
      volume: 12000000,
      change: 1000,
      change_sign: "2",
      is_adjusted: false,
    });
  });

  it("sends fid_org_adj_prc=0 when adjusted=true (default)", async () => {
    const mockFetch = vi.fn()
      .mockResolvedValueOnce(fakeTokenRes())
      .mockResolvedValueOnce(fakeKisBody({ output1: {}, output2: fakeOutput2 }));
    vi.stubGlobal("fetch", mockFetch);

    await callTool("stock_get_price_history", { stock_code: "005930", start_date: "20260705", end_date: "20260706" });

    const [apiUrl] = mockFetch.mock.calls[1] as [string];
    expect(apiUrl).toContain("fid_org_adj_prc=0");
  });

  it("sends fid_org_adj_prc=1 when adjusted=false", async () => {
    const mockFetch = vi.fn()
      .mockResolvedValueOnce(fakeTokenRes())
      .mockResolvedValueOnce(fakeKisBody({ output1: {}, output2: fakeOutput2 }));
    vi.stubGlobal("fetch", mockFetch);

    await callTool("stock_get_price_history", {
      stock_code: "005930",
      start_date: "20260705",
      end_date: "20260706",
      adjusted: false,
    });

    const [apiUrl] = mockFetch.mock.calls[1] as [string];
    expect(apiUrl).toContain("fid_org_adj_prc=1");
  });

  it("sends correct fid_period_div_code for each period", async () => {
    for (const period of ["D", "W", "M", "Y"] as const) {
      clearKisTokenCache();
      const mockFetch = vi.fn()
        .mockResolvedValueOnce(fakeTokenRes())
        .mockResolvedValueOnce(fakeKisBody({ output1: {}, output2: fakeOutput2 }));
      vi.stubGlobal("fetch", mockFetch);

      await callTool("stock_get_price_history", {
        stock_code: "005930",
        start_date: "20260705",
        end_date: "20260706",
        period,
      });

      const [apiUrl] = mockFetch.mock.calls[1] as [string];
      expect(apiUrl).toContain(`fid_period_div_code=${period}`);
    }
  });

  it("returns NO_DATA envelope when output2 is empty", async () => {
    vi.stubGlobal("fetch", vi.fn()
      .mockResolvedValueOnce(fakeTokenRes())
      .mockResolvedValueOnce(fakeKisBody({ output1: {}, output2: [] }))
    );

    const result = await callTool("stock_get_price_history", {
      stock_code: "005930",
      start_date: "20260705",
      end_date: "20260706",
    });

    expect(result.isError).toBe(true);
    expect(result.structuredContent).toMatchObject({
      ok: false,
      error: { code: "NO_DATA" },
    });
  });

  it("respects limit param — slices rows to at most limit", async () => {
    const manyRows = Array.from({ length: 10 }, (_, i) => ({
      stck_bsop_date: `2026070${i + 1}`,
      stck_clpr: "75000", stck_oprc: "74000", stck_hgpr: "75500", stck_lwpr: "73500",
      acml_vol: "12000000", acml_tr_pbmn: "900000000000",
      prdy_vrss: "0", prdy_vrss_sign: "3", mod_yn: "N",
    }));

    vi.stubGlobal("fetch", vi.fn()
      .mockResolvedValueOnce(fakeTokenRes())
      .mockResolvedValueOnce(fakeKisBody({ output1: {}, output2: manyRows }))
    );

    const result = await callTool("stock_get_price_history", {
      stock_code: "005930",
      start_date: "20260701",
      end_date: "20260710",
      limit: 5,
    });

    const rows = result.structuredContent.data.rows as unknown[];
    expect(rows).toHaveLength(5);
  });

  it("is_adjusted is true when mod_yn is Y", async () => {
    const adjustedRow = [{ ...fakeOutput2[0], mod_yn: "Y" }];
    vi.stubGlobal("fetch", vi.fn()
      .mockResolvedValueOnce(fakeTokenRes())
      .mockResolvedValueOnce(fakeKisBody({ output1: {}, output2: adjustedRow }))
    );

    const result = await callTool("stock_get_price_history", {
      stock_code: "005930",
      start_date: "20260706",
      end_date: "20260706",
    });

    expect(result.structuredContent.data.rows[0].is_adjusted).toBe(true);
  });
});
