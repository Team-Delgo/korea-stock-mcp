export type DartClientErrorCode =
  | "MISSING_API_KEY"
  | "NO_DATA"
  | "RATE_LIMITED"
  | "UPSTREAM_ERROR";

export class DartClientError extends Error {
  constructor(
    public readonly code: DartClientErrorCode,
    message: string,
    public readonly status?: string
  ) {
    super(message);
    this.name = "DartClientError";
  }
}

export interface DartClientOptions {
  apiKey?: string;
  baseUrl: string;
}

export interface DartFinancialStatementRequest {
  corpCode: string;
  year: string;
  reportCode: string;
}

export interface DartCompanyOverviewRequest {
  corpCode: string;
}

export interface DartFilingsSearchRequest {
  corpCode: string;
  startDate?: string;
  endDate?: string;
  disclosureType?: "A" | "B" | "C" | "D" | "E" | "F" | "G" | "H" | "I" | "J" | "ALL";
  finalOnly: boolean;
  page: number;
  pageSize: number;
}

export interface DartFinancialStatementItem {
  rcept_no?: string;
  reprt_code?: string;
  bsns_year?: string;
  corp_code?: string;
  stock_code?: string;
  fs_div?: string;
  fs_nm?: string;
  sj_div?: string;
  sj_nm?: string;
  account_nm?: string;
  thstrm_nm?: string;
  thstrm_amount?: string;
  frmtrm_nm?: string;
  frmtrm_amount?: string;
  bfefrmtrm_nm?: string;
  bfefrmtrm_amount?: string;
  ord?: string;
}

interface DartFinancialStatementResponse {
  status: string;
  message: string;
  list?: DartFinancialStatementItem[];
}

export interface DartCompanyOverviewResponse {
  status: string;
  message: string;
  corp_name?: string;
  corp_name_eng?: string;
  stock_name?: string;
  stock_code?: string;
  ceo_nm?: string;
  corp_cls?: string;
  jurir_no?: string;
  bizr_no?: string;
  adres?: string;
  hm_url?: string;
  ir_url?: string;
  phn_no?: string;
  fax_no?: string;
  induty_code?: string;
  est_dt?: string;
  acc_mt?: string;
}

export interface DartFilingItem {
  corp_code?: string;
  corp_name?: string;
  stock_code?: string;
  corp_cls?: string;
  report_nm?: string;
  rcept_no?: string;
  flr_nm?: string;
  rcept_dt?: string;
  rm?: string;
  pblntf_ty?: string;
}

export interface DartFilingsSearchResponse {
  status: string;
  message: string;
  page_no?: number;
  page_count?: number;
  total_count?: number;
  total_page?: number;
  list?: DartFilingItem[];
}

export class DartClient {
  constructor(private readonly options: DartClientOptions) {}

  async searchFilings(
    request: DartFilingsSearchRequest
  ): Promise<DartFilingsSearchResponse> {
    if (!this.options.apiKey) {
      throw new DartClientError(
        "MISSING_API_KEY",
        "DART_API_KEY is not configured. Add it to your environment before calling DART tools."
      );
    }

    const url = new URL("list.json", ensureTrailingSlash(this.options.baseUrl));
    url.searchParams.set("crtfc_key", this.options.apiKey);
    url.searchParams.set("corp_code", request.corpCode);
    if (request.startDate) url.searchParams.set("bgn_de", request.startDate);
    if (request.endDate) url.searchParams.set("end_de", request.endDate);
    url.searchParams.set("last_reprt_at", request.finalOnly ? "Y" : "N");
    if (request.disclosureType && request.disclosureType !== "ALL") {
      url.searchParams.set("pblntf_ty", request.disclosureType);
    }
    url.searchParams.set("page_no", String(request.page));
    url.searchParams.set("page_count", String(request.pageSize));

    let response: Response;
    try {
      response = await fetch(url);
    } catch {
      throw new DartClientError(
        "UPSTREAM_ERROR",
        "Could not reach OpenDART. Please try again later."
      );
    }

    if (!response.ok) {
      throw new DartClientError(
        "UPSTREAM_ERROR",
        `OpenDART returned HTTP ${response.status}. Please try again later.`
      );
    }

    const payload = (await response.json()) as DartFilingsSearchResponse;

    if (payload.status !== "000") {
      throw toDartClientError(
        payload.status,
        payload.message,
        "OpenDART has no filings for the requested search conditions."
      );
    }

    return payload;
  }

  async getCompanyOverview(
    request: DartCompanyOverviewRequest
  ): Promise<DartCompanyOverviewResponse> {
    if (!this.options.apiKey) {
      throw new DartClientError(
        "MISSING_API_KEY",
        "DART_API_KEY is not configured. Add it to your environment before calling DART tools."
      );
    }

    const url = new URL("company.json", ensureTrailingSlash(this.options.baseUrl));
    url.searchParams.set("crtfc_key", this.options.apiKey);
    url.searchParams.set("corp_code", request.corpCode);

    let response: Response;
    try {
      response = await fetch(url);
    } catch {
      throw new DartClientError(
        "UPSTREAM_ERROR",
        "Could not reach OpenDART. Please try again later."
      );
    }

    if (!response.ok) {
      throw new DartClientError(
        "UPSTREAM_ERROR",
        `OpenDART returned HTTP ${response.status}. Please try again later.`
      );
    }

    const payload = (await response.json()) as DartCompanyOverviewResponse;

    if (payload.status !== "000") {
      throw toDartClientError(
        payload.status,
        payload.message,
        "OpenDART has no company overview data for the requested company."
      );
    }

    return payload;
  }

  async getSingleCompanyMajorAccounts(
    request: DartFinancialStatementRequest
  ): Promise<DartFinancialStatementItem[]> {
    if (!this.options.apiKey) {
      throw new DartClientError(
        "MISSING_API_KEY",
        "DART_API_KEY is not configured. Add it to your environment before calling DART tools."
      );
    }

    const url = new URL("fnlttSinglAcnt.json", ensureTrailingSlash(this.options.baseUrl));
    url.searchParams.set("crtfc_key", this.options.apiKey);
    url.searchParams.set("corp_code", request.corpCode);
    url.searchParams.set("bsns_year", request.year);
    url.searchParams.set("reprt_code", request.reportCode);

    let response: Response;
    try {
      response = await fetch(url);
    } catch {
      throw new DartClientError(
        "UPSTREAM_ERROR",
        "Could not reach OpenDART. Please try again later."
      );
    }

    if (!response.ok) {
      throw new DartClientError(
        "UPSTREAM_ERROR",
        `OpenDART returned HTTP ${response.status}. Please try again later.`
      );
    }

    const payload = (await response.json()) as DartFinancialStatementResponse;

    if (payload.status !== "000") {
      throw toDartClientError(
        payload.status,
        payload.message,
        "OpenDART has no financial statement data for the requested company, year, and report."
      );
    }

    return payload.list ?? [];
  }
}

function ensureTrailingSlash(value: string): string {
  return value.endsWith("/") ? value : `${value}/`;
}

function toDartClientError(
  status: string,
  message: string,
  noDataMessage: string
): DartClientError {
  if (status === "013") {
    return new DartClientError("NO_DATA", noDataMessage, status);
  }

  if (status === "020") {
    return new DartClientError(
      "RATE_LIMITED",
      "OpenDART request limit was exceeded. Please retry later.",
      status
    );
  }

  if (status === "010" || status === "011" || status === "012") {
    return new DartClientError(
      "MISSING_API_KEY",
      "OpenDART rejected the API key. Check DART_API_KEY and try again.",
      status
    );
  }

  return new DartClientError(
    "UPSTREAM_ERROR",
    message || "OpenDART returned an unexpected error.",
    status
  );
}
