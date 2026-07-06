import { afterEach, describe, expect, it } from "vitest";
import {
  resetDartCorpCodeCacheForTest,
  setDartCorpCodeCacheForTest
} from "../src/services/dart-corp-code.js";
import { resolveDartCompany } from "../src/services/dart-stock-resolver.js";

describe("DART stock resolver", () => {
  afterEach(() => {
    resetDartCorpCodeCacheForTest();
  });

  it("resolves a Korean company name through stock_data_ko.json", async () => {
    setDartCorpCodeCacheForTest([]);

    const result = await resolveDartCompany({ companyName: "삼성전자" });

    expect(result).toMatchObject({
      ok: true,
      company: {
        companyName: "삼성전자",
        stockCode: "005930",
        corpCode: "00126380",
        market: "KOSPI"
      }
    });
  });

  it("normalizes whitespace in Korean company names", async () => {
    setDartCorpCodeCacheForTest([]);

    const result = await resolveDartCompany({ companyName: "삼성 전자" });

    expect(result).toMatchObject({
      ok: true,
      company: {
        stockCode: "005930",
        corpCode: "00126380"
      }
    });
  });

  it("resolves supported stock codes without requiring a company name", async () => {
    setDartCorpCodeCacheForTest([]);

    const result = await resolveDartCompany({ stockCode: "000660" });

    expect(result).toMatchObject({
      ok: true,
      company: {
        companyName: "SK하이닉스",
        stockCode: "000660",
        corpCode: "00164779"
      }
    });
  });

  it("resolves Hyundai Motor through stock JSON and OpenDART corpCode cache", async () => {
    setDartCorpCodeCacheForTest([
      {
        corpCode: "00164742",
        corpName: "현대자동차",
        corpEngName: "HYUNDAI MOTOR COMPANY",
        stockCode: "005380",
        modifyDate: "20240101"
      }
    ]);

    const result = await resolveDartCompany({ companyName: "현대차" });

    expect(result).toMatchObject({
      ok: true,
      company: {
        companyName: "현대차",
        stockCode: "005380",
        corpCode: "00164742",
        market: "KOSPI"
      }
    });
  });

  it("resolves direct stockCode input through OpenDART corpCode cache", async () => {
    setDartCorpCodeCacheForTest([
      {
        corpCode: "00164742",
        corpName: "현대자동차",
        stockCode: "005380",
        modifyDate: "20240101"
      }
    ]);

    const result = await resolveDartCompany({ stockCode: "005380" });

    expect(result).toMatchObject({
      ok: true,
      company: {
        companyName: "현대차",
        stockCode: "005380",
        corpCode: "00164742",
        market: "KOSPI"
      }
    });
  });

  it("returns a clear error when neither OpenDART cache nor fallback has corp_code", async () => {
    setDartCorpCodeCacheForTest([]);

    const result = await resolveDartCompany({ companyName: "현대차" });

    expect(result).toMatchObject({
      ok: false,
      code: "CORP_CODE_UNSUPPORTED",
      message: "종목명은 찾았지만 DART corp_code 매핑을 찾을 수 없습니다.",
      stock: {
        name: "현대차",
        code: "005380"
      }
    });
  });
});
