import { afterEach, describe, expect, it, vi } from "vitest";
import request from "supertest";
import type { AppConfig } from "../src/config.js";

const streamableHttpAccept = "application/json, text/event-stream";

const baseConfig: AppConfig = {
  host: "127.0.0.1",
  port: 3000,
  mcpEndpoint: "/mcp",
  allowedOrigins: [],
  allowedHosts: [],
  logLevel: "silent",
  cacheDbPath: "./data/test.sqlite",
  kis: {
    env: "paper",
    baseUrlReal: "https://openapi.koreainvestment.com:9443",
    baseUrlPaper: "https://openapivts.koreainvestment.com:29443"
  },
  dart: {
    apiKey: "test-key",
    baseUrl: "https://example.test/api"
  }
};

function parseSseJson(text: string) {
  const dataLine = text
    .split("\n")
    .find((line) => line.startsWith("data: "));

  if (!dataLine) {
    throw new Error(`No SSE data line found in response: ${text}`);
  }

  return JSON.parse(dataLine.slice("data: ".length));
}

function filingsPayload(status = "000") {
  if (status !== "000") {
    return {
      status,
      message: "OpenDART error"
    };
  }

  return {
    status: "000",
    message: "정상",
    page_no: 1,
    page_count: 20,
    total_count: 1,
    total_page: 1,
    list: [
      {
        corp_code: "00126380",
        corp_name: "삼성전자",
        stock_code: "005930",
        report_nm: "사업보고서 (2023.12)",
        rcept_no: "20240312000736",
        flr_nm: "삼성전자",
        rcept_dt: "20240312",
        rm: "연"
      }
    ]
  };
}

async function callFilings(arguments_: Record<string, unknown>, status = "000") {
  vi.resetModules();
  vi.stubEnv("DART_API_KEY", "test-key");
  vi.stubEnv("DART_BASE_URL", "https://example.test/api");

  const fetchMock = vi.fn(async () => Response.json(filingsPayload(status)));
  vi.stubGlobal("fetch", fetchMock);

  const { setDartCorpCodeCacheForTest } = await import(
    "../src/services/dart-corp-code.js"
  );
  const { createExpressApp } = await import("../src/server-factory.js");

  setDartCorpCodeCacheForTest([]);
  const app = createExpressApp(baseConfig);

  const response = await request(app)
    .post("/mcp")
    .set("Accept", streamableHttpAccept)
    .send({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: {
        name: "dart_search_filings",
        arguments: arguments_
      }
    })
    .expect(200);

  return {
    payload: parseSseJson(response.text),
    fetchMock
  };
}

describe("DART filings search tool", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it("searches filings by companyName through the DART resolver", async () => {
    const { payload, fetchMock } = await callFilings({
      companyName: "삼성전자"
    });
    const calledUrl = new URL(String(fetchMock.mock.calls[0][0]));

    expect(calledUrl.searchParams.get("corp_code")).toBe("00126380");
    expect(calledUrl.searchParams.get("last_reprt_at")).toBe("Y");
    expect(calledUrl.searchParams.get("pblntf_ty")).toBeNull();
    expect(payload.result.isError).toBe(false);
    expect(payload.result.structuredContent).toMatchObject({
      ok: true,
      data: {
        company: {
          company_name: "삼성전자",
          stock_code: "005930",
          corp_code: "00126380",
          market: "KOSPI"
        },
        filings: [
          {
            receipt_no: "20240312000736",
            corp_code: "00126380",
            corp_name: "삼성전자",
            stock_code: "005930",
            report_name: "사업보고서 (2023.12)",
            filer_name: "삼성전자",
            submitted_at: "20240312",
            remark: "연",
            url: "https://dart.fss.or.kr/dsaf001/main.do?rcpNo=20240312000736"
          }
        ],
        page: 1,
        page_size: 20,
        total_count: 1,
        total_page: 1
      },
      meta: {
        source: "DART",
        source_api: "list"
      }
    });
  });

  it.each([
    ["stockCode", "005930"],
    ["stock_code", "005930"]
  ])("searches filings by %s through the DART resolver", async (field, value) => {
    const { payload, fetchMock } = await callFilings({
      [field]: value
    });
    const calledUrl = new URL(String(fetchMock.mock.calls[0][0]));

    expect(calledUrl.searchParams.get("corp_code")).toBe("00126380");
    expect(payload.result.structuredContent).toMatchObject({
      ok: true,
      data: {
        company: {
          stock_code: "005930",
          corp_code: "00126380"
        }
      }
    });
  });

  it.each([
    ["corpCode", "00126380"],
    ["corp_code", "00126380"]
  ])("searches filings directly by %s without resolver company metadata", async (field, value) => {
    const { payload, fetchMock } = await callFilings({
      [field]: value
    });
    const calledUrl = new URL(String(fetchMock.mock.calls[0][0]));

    expect(calledUrl.searchParams.get("corp_code")).toBe("00126380");
    expect(payload.result.structuredContent).toMatchObject({
      ok: true,
      data: {
        company: {
          company_name: null,
          stock_code: null,
          corp_code: "00126380",
          market: null
        }
      }
    });
  });

  it("returns INVALID_INPUT for an unknown company", async () => {
    const { payload, fetchMock } = await callFilings({
      companyName: "없는회사"
    });

    expect(fetchMock).not.toHaveBeenCalled();
    expect(payload.result.isError).toBe(true);
    expect(payload.result.structuredContent).toMatchObject({
      ok: false,
      error: {
        code: "INVALID_INPUT"
      }
    });
  });

  it("returns INVALID_INPUT when no identifier is provided", async () => {
    const { payload, fetchMock } = await callFilings({});

    expect(fetchMock).not.toHaveBeenCalled();
    expect(payload.result.isError).toBe(true);
    expect(payload.result.structuredContent).toMatchObject({
      ok: false,
      error: {
        code: "INVALID_INPUT",
        message: "companyName, stockCode, corpCode, corp_code, or stock_code is required."
      }
    });
  });

  it("maps disclosure_type, final_only, page, and page_size to OpenDART params", async () => {
    const { fetchMock } = await callFilings({
      companyName: "삼성전자",
      start_date: "20240101",
      end_date: "20241231",
      disclosure_type: "A",
      final_only: false,
      page: 3,
      page_size: 40
    });
    const calledUrl = new URL(String(fetchMock.mock.calls[0][0]));

    expect(calledUrl.searchParams.get("bgn_de")).toBe("20240101");
    expect(calledUrl.searchParams.get("end_de")).toBe("20241231");
    expect(calledUrl.searchParams.get("pblntf_ty")).toBe("A");
    expect(calledUrl.searchParams.get("last_reprt_at")).toBe("N");
    expect(calledUrl.searchParams.get("page_no")).toBe("3");
    expect(calledUrl.searchParams.get("page_count")).toBe("40");
  });

  it("maps OpenDART errors through the common DART error envelope", async () => {
    const { payload } = await callFilings(
      {
        corpCode: "00126380"
      },
      "020"
    );

    expect(payload.result.isError).toBe(true);
    expect(payload.result.structuredContent).toMatchObject({
      ok: false,
      error: {
        code: "RATE_LIMITED",
        retry_after_sec: 60
      },
      meta: {
        source: "DART",
        source_api: "list"
      }
    });
  });
});
