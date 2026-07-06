import { describe, expect, it } from "vitest";
import { resolveDartCompany } from "../src/services/dart-stock-resolver.js";

describe("DART stock resolver", () => {
  it("resolves a Korean company name through stock_data_ko.json", () => {
    const result = resolveDartCompany({ companyName: "삼성전자" });

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

  it("normalizes whitespace in Korean company names", () => {
    const result = resolveDartCompany({ companyName: "삼성 전자" });

    expect(result).toMatchObject({
      ok: true,
      company: {
        stockCode: "005930",
        corpCode: "00126380"
      }
    });
  });

  it("resolves supported stock codes without requiring a company name", () => {
    const result = resolveDartCompany({ stockCode: "000660" });

    expect(result).toMatchObject({
      ok: true,
      company: {
        companyName: "SK하이닉스",
        stockCode: "000660",
        corpCode: "00164779"
      }
    });
  });

  it("returns a clear error when the stock exists but corp_code is unsupported", () => {
    const result = resolveDartCompany({ companyName: "현대차" });

    expect(result).toMatchObject({
      ok: false,
      code: "CORP_CODE_UNSUPPORTED",
      message: "종목명은 찾았지만 DART corp_code 매핑이 아직 지원되지 않습니다.",
      stock: {
        name: "현대차",
        code: "005380"
      }
    });
  });
});
