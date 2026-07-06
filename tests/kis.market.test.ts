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
    env: "real",
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

async function callTool(name: string, args: object, config = cfg) {
  const app = createExpressApp(config);
  const res = await request(app)
    .post("/mcp")
    .set("Accept", streamableHttpAccept)
    .send({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } })
    .expect(200);
  return parseSseJson(res.text).result;
}

// shared fake output rows
const fakeVolumeOutput = [
  {
    hts_kor_isnm: "삼성전자",
    mksc_shrn_iscd: "005930",
    data_rank: "1",
    stck_prpr: "75000",
    prdy_vrss: "1000",
    prdy_vrss_sign: "2",
    prdy_ctrt: "1.35",
    acml_vol: "12000000",
    acml_tr_pbmn: "900000000000",
  },
  {
    hts_kor_isnm: "SK하이닉스",
    mksc_shrn_iscd: "000660",
    data_rank: "2",
    stck_prpr: "200000",
    prdy_vrss: "-3000",
    prdy_vrss_sign: "4",
    prdy_ctrt: "-1.48",
    acml_vol: "8000000",
    acml_tr_pbmn: "1600000000000",
  },
];

const fakeFluctuationOutput = [
  {
    stck_shrn_iscd: "000040",
    data_rank: "1",
    hts_kor_isnm: "KR모터스",
    stck_prpr: "1821",
    prdy_vrss: "197",
    prdy_vrss_sign: "2",
    prdy_ctrt: "12.13",
    acml_vol: "2267183",
  },
  {
    stck_shrn_iscd: "032800",
    data_rank: "2",
    hts_kor_isnm: "판타지오",
    stck_prpr: "1200",
    prdy_vrss: "120",
    prdy_vrss_sign: "2",
    prdy_ctrt: "11.11",
    acml_vol: "1000000",
  },
];

const fakeMarketCapOutput = [
  {
    mksc_shrn_iscd: "005930",
    data_rank: "1",
    hts_kor_isnm: "삼성전자",
    stck_prpr: "75000",
    prdy_vrss: "1000",
    prdy_vrss_sign: "2",
    prdy_ctrt: "1.35",
    acml_vol: "12000000",
    stck_avls: "4474773",
  },
  {
    mksc_shrn_iscd: "000660",
    data_rank: "2",
    hts_kor_isnm: "SK하이닉스",
    stck_prpr: "200000",
    prdy_vrss: "-3000",
    prdy_vrss_sign: "4",
    prdy_ctrt: "-1.48",
    acml_vol: "8000000",
    stck_avls: "1455000",
  },
];

// ── market_get_movers: volume ────────────────────────────────────────────────

describe("market_get_movers: volume", () => {
  beforeEach(() => {
    clearKisTokenCache();
    vi.unstubAllGlobals();
  });

  it("returns ok:true envelope with normalized items", async () => {
    vi.stubGlobal("fetch", vi.fn()
      .mockResolvedValueOnce(fakeTokenRes())
      .mockResolvedValueOnce(fakeKisBody({ output: fakeVolumeOutput }))
    );

    const result = await callTool("market_get_movers", { ranking_type: "volume" });

    expect(result.isError).toBeFalsy();
    expect(result.structuredContent).toMatchObject({
      ok: true,
      data: {
        ranking_type: "volume",
        market: "ALL",
        items: expect.any(Array),
      },
    });
    expect(result.structuredContent.data.items[0]).toMatchObject({
      rank: 1,
      stock_code: "005930",
      name: "삼성전자",
      price: 75000,
      change: 1000,
      change_sign: "2",
      change_rate: 1.35,
      volume: 12000000,
      trading_value: 900000000000,
    });
  });

  it("sends FHPST01710000 tr_id and FID_BLNG_CLS_CODE=0 for volume", async () => {
    const mockFetch = vi.fn()
      .mockResolvedValueOnce(fakeTokenRes())
      .mockResolvedValueOnce(fakeKisBody({ output: fakeVolumeOutput }));
    vi.stubGlobal("fetch", mockFetch);

    await callTool("market_get_movers", { ranking_type: "volume" });

    const [apiUrl, opts] = mockFetch.mock.calls[1] as [string, RequestInit & { headers: Record<string, string> }];
    expect(apiUrl).toContain("/quotations/volume-rank");
    expect(apiUrl).toContain("fid_blng_cls_code=0");
    expect(opts.headers["tr_id"]).toBe("FHPST01710000");
  });

  it("sends FID_BLNG_CLS_CODE=3 for trading_value", async () => {
    const mockFetch = vi.fn()
      .mockResolvedValueOnce(fakeTokenRes())
      .mockResolvedValueOnce(fakeKisBody({ output: fakeVolumeOutput }));
    vi.stubGlobal("fetch", mockFetch);

    await callTool("market_get_movers", { ranking_type: "trading_value" });

    const [apiUrl] = mockFetch.mock.calls[1] as [string];
    expect(apiUrl).toContain("fid_blng_cls_code=3");
  });

  it("meta.source_api is volume-rank", async () => {
    vi.stubGlobal("fetch", vi.fn()
      .mockResolvedValueOnce(fakeTokenRes())
      .mockResolvedValueOnce(fakeKisBody({ output: fakeVolumeOutput }))
    );

    const result = await callTool("market_get_movers", { ranking_type: "volume" });

    expect(result.structuredContent.meta).toMatchObject({
      source: "KIS",
      source_api: "volume-rank",
    });
  });

  it("direction=bottom reverses the items array", async () => {
    vi.stubGlobal("fetch", vi.fn()
      .mockResolvedValueOnce(fakeTokenRes())
      .mockResolvedValueOnce(fakeKisBody({ output: fakeVolumeOutput }))
    );

    const result = await callTool("market_get_movers", { ranking_type: "volume", direction: "bottom" });

    const items = result.structuredContent.data.items as { rank: number }[];
    expect(items[0].rank).toBe(2);
    expect(items[1].rank).toBe(1);
  });

  it("limit param slices items", async () => {
    vi.stubGlobal("fetch", vi.fn()
      .mockResolvedValueOnce(fakeTokenRes())
      .mockResolvedValueOnce(fakeKisBody({ output: fakeVolumeOutput }))
    );

    const result = await callTool("market_get_movers", { ranking_type: "volume", limit: 1 });

    expect(result.structuredContent.data.items).toHaveLength(1);
  });

  it("sends fid_input_iscd=0001 for KOSPI market", async () => {
    const mockFetch = vi.fn()
      .mockResolvedValueOnce(fakeTokenRes())
      .mockResolvedValueOnce(fakeKisBody({ output: fakeVolumeOutput }));
    vi.stubGlobal("fetch", mockFetch);

    await callTool("market_get_movers", { ranking_type: "volume", market: "KOSPI" });

    const [apiUrl] = mockFetch.mock.calls[1] as [string];
    expect(apiUrl).toContain("fid_input_iscd=0001");
  });

  it("sends fid_input_iscd=1001 for KOSDAQ market", async () => {
    const mockFetch = vi.fn()
      .mockResolvedValueOnce(fakeTokenRes())
      .mockResolvedValueOnce(fakeKisBody({ output: fakeVolumeOutput }));
    vi.stubGlobal("fetch", mockFetch);

    await callTool("market_get_movers", { ranking_type: "volume", market: "KOSDAQ" });

    const [apiUrl] = mockFetch.mock.calls[1] as [string];
    expect(apiUrl).toContain("fid_input_iscd=1001");
  });
});

// ── market_get_movers: change_rate ────────────────────────────────────────────

describe("market_get_movers: change_rate", () => {
  beforeEach(() => {
    clearKisTokenCache();
    vi.unstubAllGlobals();
  });

  it("returns ok:true with stck_shrn_iscd mapped to stock_code", async () => {
    vi.stubGlobal("fetch", vi.fn()
      .mockResolvedValueOnce(fakeTokenRes())
      .mockResolvedValueOnce(fakeKisBody({ output: fakeFluctuationOutput }))
    );

    const result = await callTool("market_get_movers", { ranking_type: "change_rate" });

    expect(result.isError).toBeFalsy();
    expect(result.structuredContent.data.items[0]).toMatchObject({
      rank: 1,
      stock_code: "000040",
      name: "KR모터스",
      price: 1821,
      change: 197,
      change_rate: 12.13,
      volume: 2267183,
    });
  });

  it("sends FHPST01700000 tr_id and /ranking/fluctuation endpoint", async () => {
    const mockFetch = vi.fn()
      .mockResolvedValueOnce(fakeTokenRes())
      .mockResolvedValueOnce(fakeKisBody({ output: fakeFluctuationOutput }));
    vi.stubGlobal("fetch", mockFetch);

    await callTool("market_get_movers", { ranking_type: "change_rate" });

    const [apiUrl, opts] = mockFetch.mock.calls[1] as [string, RequestInit & { headers: Record<string, string> }];
    expect(apiUrl).toContain("/ranking/fluctuation");
    expect(opts.headers["tr_id"]).toBe("FHPST01700000");
  });

  it("direction=top sends fid_rank_sort_cls_code=0 (상승율순)", async () => {
    const mockFetch = vi.fn()
      .mockResolvedValueOnce(fakeTokenRes())
      .mockResolvedValueOnce(fakeKisBody({ output: fakeFluctuationOutput }));
    vi.stubGlobal("fetch", mockFetch);

    await callTool("market_get_movers", { ranking_type: "change_rate", direction: "top" });

    const [apiUrl] = mockFetch.mock.calls[1] as [string];
    expect(apiUrl).toContain("fid_rank_sort_cls_code=0");
  });

  it("direction=bottom sends fid_rank_sort_cls_code=1 (하락율순)", async () => {
    const mockFetch = vi.fn()
      .mockResolvedValueOnce(fakeTokenRes())
      .mockResolvedValueOnce(fakeKisBody({ output: fakeFluctuationOutput }));
    vi.stubGlobal("fetch", mockFetch);

    await callTool("market_get_movers", { ranking_type: "change_rate", direction: "bottom" });

    const [apiUrl] = mockFetch.mock.calls[1] as [string];
    expect(apiUrl).toContain("fid_rank_sort_cls_code=1");
  });
});

// ── market_get_movers: market_cap ─────────────────────────────────────────────

describe("market_get_movers: market_cap", () => {
  beforeEach(() => {
    clearKisTokenCache();
    vi.unstubAllGlobals();
  });

  it("returns ok:true with market_cap field from stck_avls", async () => {
    vi.stubGlobal("fetch", vi.fn()
      .mockResolvedValueOnce(fakeTokenRes())
      .mockResolvedValueOnce(fakeKisBody({ output: fakeMarketCapOutput }))
    );

    const result = await callTool("market_get_movers", { ranking_type: "market_cap" });

    expect(result.isError).toBeFalsy();
    expect(result.structuredContent.data.items[0]).toMatchObject({
      rank: 1,
      stock_code: "005930",
      name: "삼성전자",
      price: 75000,
      market_cap: 4474773,
    });
  });

  it("sends FHPST01740000 tr_id and /ranking/market-cap endpoint", async () => {
    const mockFetch = vi.fn()
      .mockResolvedValueOnce(fakeTokenRes())
      .mockResolvedValueOnce(fakeKisBody({ output: fakeMarketCapOutput }));
    vi.stubGlobal("fetch", mockFetch);

    await callTool("market_get_movers", { ranking_type: "market_cap" });

    const [apiUrl, opts] = mockFetch.mock.calls[1] as [string, RequestInit & { headers: Record<string, string> }];
    expect(apiUrl).toContain("/ranking/market-cap");
    expect(opts.headers["tr_id"]).toBe("FHPST01740000");
  });

  it("direction=bottom reverses market_cap items", async () => {
    vi.stubGlobal("fetch", vi.fn()
      .mockResolvedValueOnce(fakeTokenRes())
      .mockResolvedValueOnce(fakeKisBody({ output: fakeMarketCapOutput }))
    );

    const result = await callTool("market_get_movers", { ranking_type: "market_cap", direction: "bottom" });

    const items = result.structuredContent.data.items as { rank: number }[];
    expect(items[0].rank).toBe(2);
  });
});

// ── market_get_movers: NOT_IMPLEMENTED types ──────────────────────────────────

describe("market_get_movers: NOT_IMPLEMENTED types", () => {
  beforeEach(() => {
    clearKisTokenCache();
    vi.unstubAllGlobals();
  });

  for (const rankingType of ["dividend_yield", "short_sale", "credit_balance", "new_high_low"]) {
    it(`returns NOT_IMPLEMENTED for ${rankingType}`, async () => {
      const result = await callTool("market_get_movers", { ranking_type: rankingType });

      expect(result.isError).toBe(true);
      expect(result.structuredContent).toMatchObject({
        ok: false,
        error: { code: "NOT_IMPLEMENTED" },
      });
    });
  }
});

// ── market_get_movers: error handling ────────────────────────────────────────

describe("market_get_movers: error handling", () => {
  beforeEach(() => {
    clearKisTokenCache();
    vi.unstubAllGlobals();
  });

  it("returns UPSTREAM_ERROR on KIS rt_cd error", async () => {
    vi.stubGlobal("fetch", vi.fn()
      .mockResolvedValueOnce(fakeTokenRes())
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ rt_cd: "1", msg1: "시스템 오류" }),
      } as unknown as Response)
    );

    const result = await callTool("market_get_movers", { ranking_type: "volume" });

    expect(result.isError).toBe(true);
    expect(result.structuredContent).toMatchObject({
      ok: false,
      error: { code: "UPSTREAM_ERROR", message: "시스템 오류" },
    });
  });

  it("returns AUTH_EXPIRED on HTTP 401", async () => {
    vi.stubGlobal("fetch", vi.fn()
      .mockResolvedValueOnce(fakeTokenRes())
      .mockResolvedValueOnce({ ok: false, status: 401 } as Response)
    );

    const result = await callTool("market_get_movers", { ranking_type: "volume" });

    expect(result.isError).toBe(true);
    expect(result.structuredContent).toMatchObject({
      ok: false,
      error: { code: "AUTH_EXPIRED" },
    });
  });

  it("returns RATE_LIMITED on HTTP 429", async () => {
    vi.stubGlobal("fetch", vi.fn()
      .mockResolvedValueOnce(fakeTokenRes())
      .mockResolvedValueOnce({ ok: false, status: 429 } as Response)
    );

    const result = await callTool("market_get_movers", { ranking_type: "change_rate" });

    expect(result.isError).toBe(true);
    expect(result.structuredContent).toMatchObject({
      ok: false,
      error: { code: "RATE_LIMITED" },
    });
  });
});
