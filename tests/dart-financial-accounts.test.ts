import { describe, expect, it } from "vitest";
import type { DartFinancialStatementItem } from "../src/clients/dart.js";
import { summarizeFinancialAccounts } from "../src/tools/dart.js";

function row(
  accountName: string,
  amount: string,
  fsDiv: "CFS" | "OFS" = "CFS"
): DartFinancialStatementItem {
  return {
    fs_div: fsDiv,
    fs_nm: fsDiv === "CFS" ? "연결재무제표" : "재무제표",
    sj_nm: "손익계산서",
    account_nm: accountName,
    thstrm_amount: amount
  };
}

describe("DART financial account summary", () => {
  it("matches 당기순이익(손실) as net_income", () => {
    const accounts = summarizeFinancialAccounts([row("당기순이익(손실)", "1,234")]);

    expect(accounts.net_income).toMatchObject({
      account_name: "당기순이익",
      amount_krw: 1234,
      raw_amount: "1,234",
      fs_name: "연결재무제표"
    });
  });

  it("matches 연결당기순이익(손실) as net_income", () => {
    const accounts = summarizeFinancialAccounts([row("연결당기순이익(손실)", "2,345")]);

    expect(accounts.net_income.amount_krw).toBe(2345);
    expect(accounts.net_income.raw_amount).toBe("2,345");
  });

  it("prefers CFS over OFS when both are available for the same alias", () => {
    const accounts = summarizeFinancialAccounts([
      row("당기순이익", "100", "OFS"),
      row("당기순이익", "200", "CFS")
    ]);

    expect(accounts.net_income.amount_krw).toBe(200);
    expect(accounts.net_income.fs_name).toBe("연결재무제표");
  });

  it("uses OFS when CFS is not available", () => {
    const accounts = summarizeFinancialAccounts([row("영업이익", "300", "OFS")]);

    expect(accounts.operating_income.amount_krw).toBe(300);
    expect(accounts.operating_income.fs_name).toBe("재무제표");
  });

  it("keeps matching the original six exact account names", () => {
    const accounts = summarizeFinancialAccounts([
      row("매출액", "1"),
      row("영업이익", "2"),
      row("당기순이익", "3"),
      row("자산총계", "4"),
      row("부채총계", "5"),
      row("자본총계", "6")
    ]);

    expect(accounts.revenue.amount_krw).toBe(1);
    expect(accounts.operating_income.amount_krw).toBe(2);
    expect(accounts.net_income.amount_krw).toBe(3);
    expect(accounts.total_assets.amount_krw).toBe(4);
    expect(accounts.total_liabilities.amount_krw).toBe(5);
    expect(accounts.total_equity.amount_krw).toBe(6);
  });

  it("returns null fields for unmatched accounts", () => {
    const accounts = summarizeFinancialAccounts([row("기타포괄손익", "999")]);

    expect(accounts.net_income).toEqual({
      account_name: "당기순이익",
      amount_krw: null,
      raw_amount: null,
      statement_name: null,
      fs_name: null
    });
  });
});
