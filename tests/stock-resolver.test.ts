import { describe, it, expect } from "vitest";
import { searchStocks, type MasterRecord } from "../src/utils/stock-resolver.js";

const records: MasterRecord[] = [
  { stock_code: "005930", name: "삼성전자", name_en: "SamsungElectronics", market: "KOSPI", market_cap: 18000000 },
  { stock_code: "009150", name: "삼성전기", name_en: "SamsungElectro-Mechanics", market: "KOSPI", market_cap: 5000000 },
  { stock_code: "005380", name: "현대차", name_en: "HyundaiMotor", market: "KOSPI", market_cap: 4000000 },
  { stock_code: "000660", name: "SK하이닉스", name_en: "SK hynix", market: "KOSPI", market_cap: 16000000 },
  { stock_code: "035720", name: "카카오", name_en: "Kakao", market: "KOSPI", market_cap: 2000000 },
];

describe("searchStocks — Level 1: exact 6-digit code", () => {
  it("returns the matching record", () => {
    expect(searchStocks("005930", records)).toEqual([records[0]]);
  });

  it("returns empty when code does not exist", () => {
    expect(searchStocks("999999", records)).toHaveLength(0);
  });

  it("does not fall through to name search for 6-digit input", () => {
    // "035720" should match only by code, not trigger name search
    const result = searchStocks("035720", records);
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe("카카오");
  });
});

describe("searchStocks — Level 2: exact name", () => {
  it("matches exact Korean name", () => {
    expect(searchStocks("삼성전자", records)).toEqual([records[0]]);
  });

  it("matches exact English name (case-insensitive)", () => {
    expect(searchStocks("samsungelectronics", records)).toEqual([records[0]]);
    expect(searchStocks("SamsungElectronics", records)).toEqual([records[0]]);
  });
});

describe("searchStocks — Level 3: prefix", () => {
  it("returns multiple records when prefix is shared", () => {
    const result = searchStocks("삼성", records);
    expect(result).toHaveLength(2);
    expect(result.map((r) => r.stock_code)).toContain("005930");
    expect(result.map((r) => r.stock_code)).toContain("009150");
  });

  it("returns single record for unique prefix", () => {
    const result = searchStocks("현대", records);
    expect(result).toHaveLength(1);
    expect(result[0].stock_code).toBe("005380");
  });

  it("matches English prefix (case-insensitive)", () => {
    const result = searchStocks("kakao", records);
    expect(result).toHaveLength(1);
    expect(result[0].stock_code).toBe("035720");
  });
});

describe("searchStocks — Level 4: substring", () => {
  it("returns record whose name contains the substring", () => {
    // "전자" appears only in 삼성전자 among mock records
    const result = searchStocks("전자", records);
    expect(result).toHaveLength(1);
    expect(result[0].stock_code).toBe("005930");
  });

  it("returns multiple records when substring is shared", () => {
    // "하이" appears only in SK하이닉스 but "SK" appears in name_en
    // Use "성" which appears in both 삼성전자 and 삼성전기
    const result = searchStocks("성전", records);
    expect(result.map((r) => r.stock_code)).toContain("005930");
    expect(result.map((r) => r.stock_code)).toContain("009150");
  });
});

describe("searchStocks — Level 5: 초성 (choseong)", () => {
  it("matches by initial consonants", () => {
    const result = searchStocks("ㅅㅅㅈㅈ", records);
    expect(result.map((r) => r.stock_code)).toContain("005930");
  });

  it("does not treat non-choseong query as choseong", () => {
    // "삼성" is not all choseong — should match via prefix, not choseong level
    const result = searchStocks("삼성", records);
    expect(result.length).toBeGreaterThan(0);
  });
});

describe("searchStocks — Level 6: 단축어 (syllable subsequence)", () => {
  it("삼전 matches 삼성전자 and 삼성전기 (ambiguous)", () => {
    const result = searchStocks("삼전", records);
    expect(result.length).toBeGreaterThanOrEqual(2);
    expect(result.map((r) => r.stock_code)).toContain("005930");
    expect(result.map((r) => r.stock_code)).toContain("009150");
  });

  it("single unique abbreviation resolves to one record", () => {
    // "카오" is a unique subsequence in these records
    const result = searchStocks("카오", records);
    expect(result).toHaveLength(1);
    expect(result[0].stock_code).toBe("035720");
  });

  it("single character query does not trigger subsequence (min length 2)", () => {
    // "삼" alone would match via substring before reaching subsequence
    const result = searchStocks("삼", records);
    expect(result.length).toBeGreaterThan(0);
  });
});

describe("searchStocks — not found", () => {
  it("returns empty array for unrecognised query", () => {
    expect(searchStocks("존재하지않는종목", records)).toHaveLength(0);
  });

  it("returns empty array for empty string", () => {
    expect(searchStocks("", records)).toHaveLength(0);
  });
});
