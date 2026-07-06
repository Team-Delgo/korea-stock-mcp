import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import type { AppConfig } from "../src/config.js";
import { createExpressApp } from "../src/server-factory.js";
import { clearKisTokenCache } from "../src/services/kis-auth.js";
import { clearKisResponseCache } from "../src/services/kis-response-cache.js";

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

// ── resolve_etf ──────────────────────────────────────────────────────────────

describe("resolve_etf", () => {
  it("returns matches from local ETF master data for exact name", async () => {
    const result = await callTool("resolve_etf", { query: "KODEX 200" });

    expect(result.isError).toBeFalsy();
    expect(result.structuredContent).toMatchObject({
      ok: true,
      data: {
        matches: expect.arrayContaining([
          expect.objectContaining({ stock_code: "069500", name: "KODEX 200" }),
        ]),
      },
    });
  });

  it("returns NO_DATA envelope when no ETF matches", async () => {
    const result = await callTool("resolve_etf", { query: "존재하지않는ETF이름asdf" });

    expect(result.isError).toBe(true);
    expect(result.structuredContent).toMatchObject({
      ok: false,
      error: { code: "NO_DATA" },
    });
  });

  it("limit param caps number of matches", async () => {
    const result = await callTool("resolve_etf", { query: "200", limit: 2 });

    expect(result.isError).toBeFalsy();
    const matches = result.structuredContent.data.matches as unknown[];
    expect(matches.length).toBeLessThanOrEqual(2);
  });
});

// ── etf_get_quote ──────────────────────────────────────────────────────────────

describe("etf_get_quote", () => {
  beforeEach(() => {
    clearKisTokenCache();
    clearKisResponseCache();
    vi.unstubAllGlobals();
  });

  // Fixture based on the KIS "ETF_ETN 현재가[v1_국내주식-068]" Response Example (KODEX 200)
  const fakeQuoteOutput = {
    stck_prpr: "36090",
    prdy_vrss_sign: "2",
    prdy_vrss: "110",
    prdy_ctrt: "0.31",
    acml_vol: "3719307",
    prdy_vol: "6463600",
    stck_mxpr: "46770",
    stck_llam: "25190",
    stck_prdy_clpr: "35980",
    stck_oprc: "36300",
    prdy_clpr_vrss_oprc_rate: "0.89",
    stck_hgpr: "36510",
    prdy_clpr_vrss_hgpr_rate: "1.47",
    stck_lwpr: "36040",
    prdy_clpr_vrss_lwpr_rate: "0.17",
    prdy_last_nav: "36036.22",
    nav: "36127.30",
    nav_prdy_vrss: "91.08",
    nav_prdy_vrss_sign: "2",
    nav_prdy_ctrt: "0.25",
    trc_errt: "0.53",
    stck_sdpr: "35980",
    stck_sspr: "28780",
    etf_crcl_stcn: "191550000",
    etf_ntas_ttam: "69027",
    etf_frcr_ntas_ttam: "0",
    frgn_limt_rate: "100.0000",
    frgn_oder_able_qty: "150950685",
    etf_cu_unit_scrt_cnt: "50000",
    etf_cnfg_issu_cnt: "201",
    etf_dvdn_cycl: "2",
    crcd: "KRW",
    etf_crcl_ntas_ttam: "0",
    etf_frcr_crcl_ntas_ttam: "0",
    etf_frcr_last_ntas_wrth_val: "0",
    lp_oder_able_cls_code: "N",
    stck_dryy_hgpr: "36510",
    dryy_hgpr_vrss_prpr_rate: "-1.15",
    dryy_hgpr_date: "20240223",
    stck_dryy_lwpr: "32748",
    dryy_lwpr_vrss_prpr_rate: "10.21",
    dryy_lwpr_date: "20240118",
    bstp_kor_isnm: "ETF(실물복제/수익증권)",
    vi_cls_code: "N",
    lstn_stcn: "191550000",
    frgn_hldn_qty: "40599315",
    frgn_hldn_qty_rate: "21.20",
    etf_trc_ert_mltp: "1.00",
    dprt: "-0.10",
    mbcr_name: "삼성자산운용(ETF)",
    stck_lstn_date: "20021014",
    mtrt_date: "0",
    shrg_type_code: "  ",
    lp_hldn_rate: "0.00",
    etf_trgt_nmix_bstp_code: "2001",
    etf_div_name: "수익증권형",
    etf_rprs_bstp_kor_isnm: "KOSPI200",
    lp_hldn_vol: "0",
  };

  it("returns ok:true envelope with normalized numeric fields", async () => {
    vi.stubGlobal("fetch", vi.fn()
      .mockResolvedValueOnce(fakeTokenRes())
      .mockResolvedValueOnce(fakeKisBody({ output: fakeQuoteOutput }))
    );

    const result = await callTool("etf_get_quote", { stock_code: "069500" });

    expect(result.isError).toBeFalsy();
    expect(result.structuredContent).toMatchObject({
      ok: true,
      data: {
        stock_code: "069500",
        price: 36090,
        change: 110,
        change_sign: "2",
        change_rate: 0.31,
        volume: 3719307,
        nav: 36127.30,
        nav_change: 91.08,
        nav_change_rate: 0.25,
        tracking_error_rate: 0.53,
        premium_discount_rate: -0.10,
        tracking_multiple: 1.00,
        net_asset_total: 69027,
        holdings_count: 201,
        asset_manager: "삼성자산운용(ETF)",
        etf_type: "수익증권형",
        tracking_index: "KOSPI200",
      },
    });
  });

  it("resolves ETF name to stock_code before calling KIS", async () => {
    vi.stubGlobal("fetch", vi.fn()
      .mockResolvedValueOnce(fakeTokenRes())
      .mockResolvedValueOnce(fakeKisBody({ output: fakeQuoteOutput }))
    );

    const result = await callTool("etf_get_quote", { stock_code: "KODEX 200" });

    expect(result.isError).toBeFalsy();
    expect(result.structuredContent.data).toMatchObject({ stock_code: "069500" });
  });

  it("meta.source is KIS and source_api is etfetn-inquire-price", async () => {
    vi.stubGlobal("fetch", vi.fn()
      .mockResolvedValueOnce(fakeTokenRes())
      .mockResolvedValueOnce(fakeKisBody({ output: fakeQuoteOutput }))
    );

    const result = await callTool("etf_get_quote", { stock_code: "069500" });

    expect(result.structuredContent.meta).toMatchObject({
      source: "KIS",
      source_api: "etfetn-inquire-price",
    });
  });

  it("uses the correct TR_ID and path against the KIS endpoint", async () => {
    const mockFetch = vi.fn()
      .mockResolvedValueOnce(fakeTokenRes())
      .mockResolvedValueOnce(fakeKisBody({ output: fakeQuoteOutput }));
    vi.stubGlobal("fetch", mockFetch);

    await callTool("etf_get_quote", { stock_code: "069500" });

    const [apiUrl, opts] = mockFetch.mock.calls[1] as [string, RequestInit & { headers: Record<string, string> }];
    expect(apiUrl).toContain("/uapi/etfetn/v1/quotations/inquire-price");
    expect(apiUrl).toContain("fid_input_iscd=069500");
    expect(opts.headers["tr_id"]).toBe("VHPST02400000");
  });

  it("returns NO_DATA envelope for an unknown ETF query", async () => {
    const result = await callTool("etf_get_quote", { stock_code: "존재하지않는ETF이름asdf" });

    expect(result.isError).toBe(true);
    expect(result.structuredContent).toMatchObject({
      ok: false,
      error: { code: "NO_DATA" },
    });
  });

  it("returns UPSTREAM_ERROR envelope on KIS rt_cd error", async () => {
    vi.stubGlobal("fetch", vi.fn()
      .mockResolvedValueOnce(fakeTokenRes())
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ rt_cd: "1", msg1: "종목코드 오류" }),
      } as unknown as Response)
    );

    const result = await callTool("etf_get_quote", { stock_code: "069500" });

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

    const result = await callTool("etf_get_quote", { stock_code: "069500" });

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

    const result = await callTool("etf_get_quote", { stock_code: "069500" });

    expect(result.isError).toBe(true);
    expect(result.structuredContent).toMatchObject({
      ok: false,
      error: { code: "RATE_LIMITED" },
    });
  });
});

// ── etf_get_holdings ─────────────────────────────────────────────────────────

describe("etf_get_holdings", () => {
  beforeEach(() => {
    clearKisTokenCache();
    clearKisResponseCache();
    vi.unstubAllGlobals();
  });

  // Fixture based on the KIS "ETF 구성종목시세[국내주식-073]" Response Example (KODEX 200)
  const fakeOutput1 = {
    stck_prpr: "37195",
    prdy_vrss: "-365",
    prdy_vrss_sign: "5",
    prdy_ctrt: "-0.97",
    etf_cnfg_issu_avls: "184153",
    nav: "37301.11",
    nav_prdy_vrss_sign: "5",
    nav_prdy_vrss: "-347.36",
    nav_prdy_ctrt: "-0.92",
    etf_ntas_ttam: "68256",
    prdy_clpr_nav: "37648.47",
    oprc_nav: "37653.39",
    hprc_nav: "37720.17",
    lprc_nav: "37223.93",
    etf_cu_unit_scrt_cnt: "50000",
    etf_cnfg_issu_cnt: "201",
  };

  const fakeOutput2 = [
    {
      stck_shrn_iscd: "005930",
      hts_kor_isnm: "삼성전자",
      stck_prpr: "83700",
      prdy_vrss: "-400",
      prdy_vrss_sign: "5",
      prdy_ctrt: "-0.48",
      acml_vol: "16967184",
      acml_tr_pbmn: "1421776834400",
      tday_rsfl_rate: "2.02",
      prdy_vrss_vol: "-8570824",
      tr_pbmn_tnrt: "0.28",
      hts_avls: "4996708",
      etf_cnfg_issu_avls: "601300800",
      etf_cnfg_issu_rlim: "32.65",
      etf_vltn_amt: "604174400",
    },
    {
      stck_shrn_iscd: "000660",
      hts_kor_isnm: "SK하이닉스",
      stck_prpr: "187400",
      prdy_vrss: "-1000",
      prdy_vrss_sign: "5",
      prdy_ctrt: "-0.53",
      acml_vol: "3042349",
      acml_tr_pbmn: "575151315700",
      tday_rsfl_rate: "2.34",
      prdy_vrss_vol: "-1055882",
      tr_pbmn_tnrt: "0.42",
      hts_avls: "1364276",
      etf_cnfg_issu_avls: "160039600",
      etf_cnfg_issu_rlim: "8.69",
      etf_vltn_amt: "160893600",
    },
  ];

  it("returns ok:true with ETF summary and holdings sorted by weight", async () => {
    vi.stubGlobal("fetch", vi.fn()
      .mockResolvedValueOnce(fakeTokenRes())
      .mockResolvedValueOnce(fakeKisBody({ output1: fakeOutput1, output2: fakeOutput2 }))
    );

    const result = await callTool("etf_get_holdings", { stock_code: "069500" });

    expect(result.isError).toBeFalsy();
    expect(result.structuredContent).toMatchObject({
      ok: true,
      data: {
        stock_code: "069500",
        nav: 37301.11,
        net_asset_total: 68256,
        holdings_count: 201,
        cu_unit_shares: 50000,
      },
    });

    const holdings = result.structuredContent.data.holdings as { stock_code: string; weight: number }[];
    expect(holdings).toHaveLength(2);
    expect(holdings[0]).toMatchObject({ stock_code: "005930", name: "삼성전자", weight: 32.65 });
    expect(holdings[1]).toMatchObject({ stock_code: "000660", name: "SK하이닉스", weight: 8.69 });
  });

  it("limit param caps the number of returned holdings", async () => {
    vi.stubGlobal("fetch", vi.fn()
      .mockResolvedValueOnce(fakeTokenRes())
      .mockResolvedValueOnce(fakeKisBody({ output1: fakeOutput1, output2: fakeOutput2 }))
    );

    const result = await callTool("etf_get_holdings", { stock_code: "069500", limit: 1 });

    const holdings = result.structuredContent.data.holdings as unknown[];
    expect(holdings).toHaveLength(1);
  });

  it("uses the correct TR_ID, path, and fixed screen-division param", async () => {
    const mockFetch = vi.fn()
      .mockResolvedValueOnce(fakeTokenRes())
      .mockResolvedValueOnce(fakeKisBody({ output1: fakeOutput1, output2: fakeOutput2 }));
    vi.stubGlobal("fetch", mockFetch);

    await callTool("etf_get_holdings", { stock_code: "069500" });

    const [apiUrl, opts] = mockFetch.mock.calls[1] as [string, RequestInit & { headers: Record<string, string> }];
    expect(apiUrl).toContain("/uapi/etfetn/v1/quotations/inquire-component-stock-price");
    expect(apiUrl).toContain("fid_cond_scr_div_code=11216");
    expect(opts.headers["tr_id"]).toBe("VHKST121600C0");
  });

  it("returns NO_DATA envelope when output2 is empty", async () => {
    vi.stubGlobal("fetch", vi.fn()
      .mockResolvedValueOnce(fakeTokenRes())
      .mockResolvedValueOnce(fakeKisBody({ output1: fakeOutput1, output2: [] }))
    );

    const result = await callTool("etf_get_holdings", { stock_code: "069500" });

    expect(result.isError).toBe(true);
    expect(result.structuredContent).toMatchObject({
      ok: false,
      error: { code: "NO_DATA" },
    });
  });

  it("returns AMBIGUOUS envelope with candidates for a query matching multiple ETFs", async () => {
    const result = await callTool("etf_get_holdings", { stock_code: "KODEX" });

    expect(result.isError).toBe(true);
    expect(result.structuredContent).toMatchObject({
      ok: false,
      error: { code: "AMBIGUOUS" },
    });
    const candidates = result.structuredContent.error.candidates as unknown[];
    expect(candidates.length).toBeGreaterThan(1);
  });
});
