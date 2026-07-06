import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { config as defaultConfig } from "../config.js";
import {
  DartClient,
  DartClientError,
  type DartCompanyOverviewResponse,
  type DartFinancialStatementItem
} from "../clients/dart.js";
import { createMeta, envelopeOutputSchema, successEnvelope } from "../schemas/common.js";
import { resolveDartCompany } from "../services/dart-stock-resolver.js";
import { jsonToolResponse, registerNotImplementedTool } from "./helpers.js";

const dartFinancialStatementInputSchema = {
  companyName: z.string().min(1).optional(),
  stockCode: z.string().regex(/^\d{6}$/).optional(),
  year: z.string().regex(/^\d{4}$/),
  reportCode: z.enum(["11013", "11012", "11014", "11011"]).default("11011")
};

const dartCompanyOverviewInputSchema = {
  companyName: z.string().min(1).optional(),
  stockCode: z.string().regex(/^\d{6}$/).optional()
};

const TARGET_ACCOUNT_ALIASES = {
  revenue: ["매출액", "수익(매출액)", "영업수익"],
  operating_income: ["영업이익", "영업이익(손실)", "영업손익"],
  net_income: [
    "당기순이익",
    "당기순이익(손실)",
    "연결당기순이익",
    "연결당기순이익(손실)",
    "당기순손익",
    "당기순손익(손실)",
    "연결당기순손익",
    "연결당기순손익(손실)",
    "지배기업의 소유주에게 귀속되는 당기순이익",
    "지배기업 소유주지분 순이익"
  ],
  total_assets: ["자산총계", "총자산"],
  total_liabilities: ["부채총계", "총부채"],
  total_equity: ["자본총계", "총자본"]
} as const;

type TargetAccountKey = keyof typeof TARGET_ACCOUNT_ALIASES;

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

  server.registerTool(
    "dart_get_company_overview",
    {
      title: "Get DART Company Overview",
      description: "Get company overview information from OpenDART.",
      inputSchema: dartCompanyOverviewInputSchema,
      outputSchema: envelopeOutputSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true
      }
    },
    async ({ companyName, stockCode }) => {
      const companyResolution = await resolveDartCompany({ companyName, stockCode });

      if (!companyResolution.ok) {
        return jsonToolResponse(
          {
            ok: false,
            error: {
              code: "INVALID_INPUT",
              message: companyResolution.message
            },
            meta: createMeta("DART", "dart_get_company_overview")
          },
          true
        );
      }

      const { company } = companyResolution;
      const client = new DartClient(defaultConfig.dart);

      try {
        const overview = await client.getCompanyOverview({
          corpCode: company.corpCode
        });

        return jsonToolResponse(
          successEnvelope(
            {
              company: {
                company_name: company.companyName,
                stock_code: company.stockCode,
                corp_code: company.corpCode,
                market: company.market
              },
              overview: normalizeCompanyOverview(overview)
            },
            createMeta("DART", "company")
          )
        );
      } catch (error) {
        const mappedError = mapDartError(error);
        return jsonToolResponse(
          {
            ok: false,
            error: mappedError,
            meta: createMeta("DART", "company")
          },
          true
        );
      }
    }
  );

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
      const companyResolution = await resolveDartCompany({ companyName, stockCode });

      if (!companyResolution.ok) {
        return jsonToolResponse(
          {
            ok: false,
            error: {
              code: "INVALID_INPUT",
              message: companyResolution.message
            },
            meta: createMeta("DART", "dart_get_financial_statement")
          },
          true
        );
      }

      const { company } = companyResolution;
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
                corp_code: company.corpCode,
                market: company.market
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

export function normalizeCompanyOverview(overview: DartCompanyOverviewResponse) {
  return {
    official_name: nullableString(overview.corp_name),
    english_name: nullableString(overview.corp_name_eng),
    stock_name: nullableString(overview.stock_name),
    ceo_name: nullableString(overview.ceo_nm),
    corporation_class: nullableString(overview.corp_cls),
    corporation_class_name: getCorporationClassName(overview.corp_cls),
    jurir_no: nullableString(overview.jurir_no),
    business_registration_no: nullableString(overview.bizr_no),
    address: nullableString(overview.adres),
    homepage_url: nullableString(overview.hm_url),
    ir_url: nullableString(overview.ir_url),
    phone_number: nullableString(overview.phn_no),
    fax_number: nullableString(overview.fax_no),
    industry_code: nullableString(overview.induty_code),
    established_date: nullableString(overview.est_dt),
    fiscal_month: nullableString(overview.acc_mt)
  };
}

export function summarizeFinancialAccounts(rows: DartFinancialStatementItem[]) {
  return Object.fromEntries(
    Object.entries(TARGET_ACCOUNT_ALIASES).map(([accountKey, aliases]) => {
      const row = findAccountRow(rows, aliases);
      const accountName = getPrimaryAccountName(accountKey as TargetAccountKey);

      return [
        accountKey,
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

function nullableString(value: string | undefined): string | null {
  const trimmed = value?.trim() ?? "";
  return trimmed ? trimmed : null;
}

function getCorporationClassName(value: string | undefined): string | null {
  const names: Record<string, string> = {
    Y: "유가증권시장",
    K: "코스닥",
    N: "코넥스",
    E: "기타"
  };

  return value ? names[value] ?? null : null;
}

function findAccountRow(
  rows: DartFinancialStatementItem[],
  aliases: readonly string[]
): DartFinancialStatementItem | undefined {
  for (const alias of aliases) {
    const normalizedAlias = normalizeAccountName(alias);
    const matchingRows = rows.filter(
      (row) => normalizeAccountName(row.account_nm) === normalizedAlias
    );

    const preferredRow =
      matchingRows.find((row) => row.fs_div === "CFS") ??
      matchingRows.find((row) => row.fs_div === "OFS") ??
      matchingRows[0];

    if (preferredRow) {
      return preferredRow;
    }
  }

  return undefined;
}

function normalizeAccountName(value: string | undefined): string {
  return value?.replace(/\s/g, "") ?? "";
}

function parseKrwAmount(value: string | undefined): number | null {
  if (!value || value === "-") return null;

  const normalized = value.replaceAll(",", "").trim();
  const parsed = Number(normalized);

  return Number.isFinite(parsed) ? parsed : null;
}

function getPrimaryAccountName(accountKey: TargetAccountKey): string {
  const names: Record<TargetAccountKey, string> = {
    revenue: "매출액",
    operating_income: "영업이익",
    net_income: "당기순이익",
    total_assets: "자산총계",
    total_liabilities: "부채총계",
    total_equity: "자본총계"
  };

  return names[accountKey];
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
