import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { config as defaultConfig } from "../config.js";
import {
  DartClient,
  DartClientError,
  type DartFinancialStatementItem
} from "../clients/dart.js";
import { createMeta, envelopeOutputSchema, successEnvelope } from "../schemas/common.js";
import { jsonToolResponse, registerNotImplementedTool } from "./helpers.js";

const dartFinancialStatementInputSchema = {
  companyName: z.string().min(1).optional(),
  stockCode: z.string().regex(/^\d{6}$/).optional(),
  year: z.string().regex(/^\d{4}$/),
  reportCode: z.enum(["11013", "11012", "11014", "11011"]).default("11011")
};

const DART_COMPANY_MAPPINGS = [
  {
    companyName: "삼성전자",
    stockCode: "005930",
    corpCode: "00126380"
  },
  {
    companyName: "SK하이닉스",
    stockCode: "000660",
    corpCode: "00164779"
  },
  {
    companyName: "LG에너지솔루션",
    stockCode: "373220",
    corpCode: "01515323"
  }
] as const;

const TARGET_ACCOUNTS = [
  "매출액",
  "영업이익",
  "당기순이익",
  "자산총계",
  "부채총계",
  "자본총계"
] as const;

type TargetAccountName = (typeof TARGET_ACCOUNTS)[number];

export function registerDartTools(server: McpServer) {
  registerNotImplementedTool(server, {
    name: "dart_search_filings",
    title: "Search DART Filings",
    description: "Search DART disclosures by corporation, stock, date, and type.",
    inputSchema: {
      corp_code: z.string().optional(),
      stock_code: z.string().regex(/^\d{6}$/).optional(),
      start_date: z.string().optional(),
      end_date: z.string().optional(),
      disclosure_type: z
        .enum(["A", "B", "C", "D", "E", "F", "G", "H", "I", "J", "ALL"])
        .default("ALL"),
      final_only: z.boolean().default(true),
      page: z.number().int().positive().default(1),
      page_size: z.number().int().positive().max(100).default(20)
    }
  });

  registerNotImplementedTool(server, {
    name: "dart_get_company_overview",
    title: "Get DART Company Overview",
    description: "Get company overview information from DART.",
    inputSchema: {
      corp_code: z.string().min(1)
    }
  });

  server.registerTool(
    "dart_get_financial_statement",
    {
      title: "Get DART Financial Statement",
      description: "Get major financial statement accounts from OpenDART.",
      inputSchema: dartFinancialStatementInputSchema,
      outputSchema: envelopeOutputSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true
      }
    },
    async ({ companyName, stockCode, year, reportCode }) => {
      const company = resolveDartCompany({ companyName, stockCode });

      if (!company) {
        return jsonToolResponse(
          {
            ok: false,
            error: {
              code: "INVALID_INPUT",
              message:
                "Supported companies for this MVP are 삼성전자, SK하이닉스, and LG에너지솔루션. Provide companyName or stockCode."
            },
            meta: createMeta("DART", "dart_get_financial_statement")
          },
          true
        );
      }

      const client = new DartClient(defaultConfig.dart);

      try {
        const rows = await client.getSingleCompanyMajorAccounts({
          corpCode: company.corpCode,
          year,
          reportCode
        });

        return jsonToolResponse(
          successEnvelope(
            {
              company: {
                company_name: company.companyName,
                stock_code: company.stockCode,
                corp_code: company.corpCode
              },
              business_year: year,
              report_code: reportCode,
              accounts: summarizeFinancialAccounts(rows)
            },
            createMeta("DART", "fnlttSinglAcnt")
          )
        );
      } catch (error) {
        const mappedError = mapDartError(error);
        return jsonToolResponse(
          {
            ok: false,
            error: mappedError,
            meta: createMeta("DART", "fnlttSinglAcnt")
          },
          true
        );
      }
    }
  );
}

function resolveDartCompany(input: { companyName?: string; stockCode?: string }) {
  const normalizedCompanyName = input.companyName?.replace(/\s/g, "").toLowerCase();

  return DART_COMPANY_MAPPINGS.find((company) => {
    const mappedName = company.companyName.replace(/\s/g, "").toLowerCase();
    return (
      (normalizedCompanyName && mappedName === normalizedCompanyName) ||
      (input.stockCode && company.stockCode === input.stockCode)
    );
  });
}

function summarizeFinancialAccounts(rows: DartFinancialStatementItem[]) {
  return Object.fromEntries(
    TARGET_ACCOUNTS.map((accountName) => {
      const row = findAccountRow(rows, accountName);

      return [
        toSnakeCaseAccountKey(accountName),
        {
          account_name: accountName,
          amount_krw: row ? parseKrwAmount(row.thstrm_amount) : null,
          raw_amount: row?.thstrm_amount ?? null,
          statement_name: row?.sj_nm ?? null,
          fs_name: row?.fs_nm ?? null
        }
      ];
    })
  );
}

function findAccountRow(
  rows: DartFinancialStatementItem[],
  accountName: TargetAccountName
): DartFinancialStatementItem | undefined {
  const matchingRows = rows.filter((row) => row.account_nm === accountName);

  return (
    matchingRows.find((row) => row.fs_div === "CFS") ??
    matchingRows.find((row) => row.fs_div === "OFS") ??
    matchingRows[0]
  );
}

function parseKrwAmount(value: string | undefined): number | null {
  if (!value || value === "-") return null;

  const normalized = value.replaceAll(",", "").trim();
  const parsed = Number(normalized);

  return Number.isFinite(parsed) ? parsed : null;
}

function toSnakeCaseAccountKey(accountName: TargetAccountName): string {
  const keys: Record<TargetAccountName, string> = {
    매출액: "revenue",
    영업이익: "operating_income",
    당기순이익: "net_income",
    자산총계: "total_assets",
    부채총계: "total_liabilities",
    자본총계: "total_equity"
  };

  return keys[accountName];
}

function mapDartError(error: unknown) {
  if (error instanceof DartClientError) {
    if (error.code === "NO_DATA") {
      return {
        code: "NO_DATA",
        message: error.message
      };
    }

    if (error.code === "RATE_LIMITED") {
      return {
        code: "RATE_LIMITED",
        message: error.message,
        retry_after_sec: 60
      };
    }

    if (error.code === "MISSING_API_KEY") {
      return {
        code: "INVALID_INPUT",
        message: error.message
      };
    }

    return {
      code: "UPSTREAM_ERROR",
      message: error.message
    };
  }

  return {
    code: "UPSTREAM_ERROR",
    message: "Unexpected error while calling OpenDART."
  };
}
