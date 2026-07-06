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

async function callCompanyOverview(arguments_: Record<string, unknown>) {
  vi.resetModules();
  vi.stubEnv("DART_API_KEY", "test-key");
  vi.stubEnv("DART_BASE_URL", "https://example.test/api");

  const fetchMock = vi.fn(async () =>
    Response.json({
      status: "000",
      message: "정상",
      corp_name: "삼성전자주식회사",
      corp_name_eng: "SAMSUNG ELECTRONICS CO., LTD.",
      stock_name: "삼성전자",
      stock_code: "005930",
      ceo_nm: "한종희",
      corp_cls: "Y",
      jurir_no: "1301110006246",
      bizr_no: "",
      adres: "경기도 수원시 영통구 삼성로 129",
      hm_url: "www.samsung.com/sec",
      ir_url: "",
      phn_no: "031-200-1114",
      fax_no: "",
      induty_code: "264",
      est_dt: "19690113",
      acc_mt: "12"
    })
  );
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
        name: "dart_get_company_overview",
        arguments: arguments_
      }
    })
    .expect(200);

  return {
    payload: parseSseJson(response.text),
    fetchMock
  };
}

describe("DART company overview tool", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it("resolves a company name and returns a normalized overview envelope", async () => {
    const { payload, fetchMock } = await callCompanyOverview({
      companyName: "삼성전자"
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0][0])).toBe(
      "https://example.test/api/company.json?crtfc_key=test-key&corp_code=00126380"
    );
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
        overview: {
          official_name: "삼성전자주식회사",
          english_name: "SAMSUNG ELECTRONICS CO., LTD.",
          stock_name: "삼성전자",
          ceo_name: "한종희",
          corporation_class: "Y",
          corporation_class_name: "유가증권시장",
          business_registration_no: null,
          established_date: "19690113",
          fiscal_month: "12"
        }
      },
      meta: {
        source: "DART",
        source_api: "company"
      }
    });
  });

  it("resolves a stock code and returns a normalized overview envelope", async () => {
    const { payload } = await callCompanyOverview({
      stockCode: "005930"
    });

    expect(payload.result.structuredContent).toMatchObject({
      ok: true,
      data: {
        company: {
          company_name: "삼성전자",
          stock_code: "005930",
          corp_code: "00126380"
        }
      }
    });
  });

  it("returns INVALID_INPUT when no identifier is provided", async () => {
    const { payload, fetchMock } = await callCompanyOverview({});

    expect(fetchMock).not.toHaveBeenCalled();
    expect(payload.result.isError).toBe(true);
    expect(payload.result.structuredContent).toMatchObject({
      ok: false,
      error: {
        code: "INVALID_INPUT",
        message: "companyName or stockCode is required."
      }
    });
  });

  it("returns INVALID_INPUT for unsupported company corp code mapping", async () => {
    const { payload, fetchMock } = await callCompanyOverview({
      companyName: "현대차"
    });

    expect(fetchMock).not.toHaveBeenCalled();
    expect(payload.result.isError).toBe(true);
    expect(payload.result.structuredContent).toMatchObject({
      ok: false,
      error: {
        code: "INVALID_INPUT",
        message: "종목명은 찾았지만 DART corp_code 매핑을 찾을 수 없습니다."
      }
    });
  });
});
