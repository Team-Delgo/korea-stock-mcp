import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { config as defaultConfig } from "../config.js";
import {
  DartClient,
  DartClientError,
  type DartCompanyOverviewResponse,
  type DartFilingItem,
  type DartFinancialStatementItem
} from "../clients/dart.js";
import { createMeta, envelopeOutputSchema, successEnvelope } from "../schemas/common.js";
import { resolveDartCompany } from "../services/dart-stock-resolver.js";
import { jsonToolResponse } from "./helpers.js";

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

const dartSearchFilingsInputSchema = {
  companyName: z.string().min(1).optional(),
  stockCode: z.string().regex(/^\d{6}$/).optional(),
  corpCode: z.string().min(1).optional(),
  corp_code: z.string().min(1).optional(),
  stock_code: z.string().regex(/^\d{6}$/).optional(),
  start_date: z.string().optional(),
  end_date: z.string().optional(),
  disclosure_type: z
    .enum(["A", "B", "C", "D", "E", "F", "G", "H", "I", "J", "ALL"])
    .default("ALL"),
  final_only: z.boolean().default(true),
  page: z.number().int().positive().default(1),
  page_size: z.number().int().positive().max(100).default(20)
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
  server.registerTool(
    "dart_search_filings",
    {
      title: "Search DART Filings",
      description: "Search DART disclosures by corporation, stock, date, and type.",
      inputSchema: dartSearchFilingsInputSchema,
      outputSchema: envelopeOutputSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true
      }
    },
    async ({
      companyName,
      stockCode,
      corpCode,
      corp_code,
      stock_code,
      start_date,
      end_date,
      disclosure_type,
      final_only,
      page,
      page_size
    }) => {
      const companyResolution = await resolveSearchFilingsCompany({
        companyName,
        stockCode,
        stock_code,
        corpCode,
        corp_code
      });

      if (!companyResolution.ok) {
        return jsonToolResponse(
          {
            ok: false,
            error: {
              code: "INVALID_INPUT",
              message: companyResolution.message
            },
            meta: createMeta("DART", "dart_search_filings")
          },
          true
        );
      }

      const client = new DartClient(defaultConfig.dart);

      try {
        const filingsResponse = await client.searchFilings({
          corpCode: companyResolution.corpCode,
          startDate: start_date,
          endDate: end_date,
          disclosureType: disclosure_type,
          finalOnly: final_only,
          page,
          pageSize: page_size
        });

        return jsonToolResponse(
          successEnvelope(
            {
              company: normalizeResolvedCompany(companyResolution.company, companyResolution.corpCode),
              filings: normalizeFilings(filingsResponse.list ?? []),
              page: filingsResponse.page_no ?? page,
              page_size: filingsResponse.page_count ?? page_size,
              total_count: filingsResponse.total_count ?? 0,
              total_page: filingsResponse.total_page ?? 0
            },
            createMeta("DART", "list")
          )
        );
      } catch (error) {
        const mappedError = mapDartError(error);
        return jsonToolResponse(
          {
            ok: false,
            error: mappedError,
            meta: createMeta("DART", "list")
          },
          true
        );
      }
    }
  );

  server.registerTool(
    "dart_get_company_overview",
    {
      title: "DART 기업 개요 조회",
      description: "종목명 또는 6자리 종목코드로 OpenDART 기업 개황 정보를 조회합니다.",
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
      title: "DART 주요 재무제표 조회",
      description: "종목명 또는 6자리 종목코드로 OpenDART 단일회사 주요 재무계정 정보를 조회합니다.",
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

interface SearchFilingsResolvedCompany {
  companyName: string;
  stockCode: string;
  corpCode: string;
  market: string;
}

type SearchFilingsCompanyResolution =
  | {
      ok: true;
      corpCode: string;
      company?: SearchFilingsResolvedCompany;
    }
  | {
      ok: false;
      message: string;
    };

async function resolveSearchFilingsCompany(input: {
  companyName?: string;
  stockCode?: string;
  stock_code?: string;
  corpCode?: string;
  corp_code?: string;
}): Promise<SearchFilingsCompanyResolution> {
  const directCorpCode = input.corpCode ?? input.corp_code;

  if (input.companyName || input.stockCode || input.stock_code) {
    const companyResolution = await resolveDartCompany({
      companyName: input.companyName,
      stockCode: input.stockCode ?? input.stock_code
    });

    if (!companyResolution.ok) {
      return {
        ok: false,
        message: companyResolution.message
      };
    }

    return {
      ok: true,
      corpCode: companyResolution.company.corpCode,
      company: companyResolution.company
    };
  }

  if (directCorpCode) {
    return {
      ok: true,
      corpCode: directCorpCode
    };
  }

  return {
    ok: false,
    message: "companyName, stockCode, corpCode, corp_code, or stock_code is required."
  };
}

function normalizeResolvedCompany(
  company: SearchFilingsResolvedCompany | undefined,
  corpCode: string
) {
  if (!company) {
    return {
      company_name: null,
      stock_code: null,
      corp_code: corpCode,
      market: null
    };
  }

  return {
    company_name: company.companyName,
    stock_code: company.stockCode,
    corp_code: company.corpCode,
    market: company.market
  };
}

export function normalizeFilings(rows: DartFilingItem[]) {
  return rows.map((row) => {
    const receiptNo = nullableString(row.rcept_no);

    return {
      receipt_no: receiptNo,
      corp_code: nullableString(row.corp_code),
      corp_name: nullableString(row.corp_name),
      stock_code: nullableString(row.stock_code),
      report_name: nullableString(row.report_nm),
      filer_name: nullableString(row.flr_nm),
      submitted_at: nullableString(row.rcept_dt),
      disclosure_type: nullableString(row.pblntf_ty),
      remark: nullableString(row.rm),
      url: receiptNo ? `https://dart.fss.or.kr/dsaf001/main.do?rcpNo=${receiptNo}` : null
    };
  });
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
