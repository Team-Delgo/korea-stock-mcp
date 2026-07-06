import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { getDartCorpCodeByStockCode } from "./dart-corp-code.js";

export type StockDataLanguage = "ko" | "en";

export interface StockDataItem {
  name: string;
  code: string;
  market: string;
  marketCap: number;
}

export interface DartResolvedCompany {
  companyName: string;
  stockCode: string;
  corpCode: string;
  market: string;
}

export type DartCompanyResolution =
  | {
      ok: true;
      company: DartResolvedCompany;
    }
  | {
      ok: false;
      code: "MISSING_IDENTIFIER" | "STOCK_NOT_FOUND" | "CORP_CODE_UNSUPPORTED";
      message: string;
      stock?: StockDataItem;
    };

const DART_CORP_CODE_BY_STOCK_CODE: Record<
  string,
  { corpCode: string; fallbackCompanyName: string }
> = {
  "005930": {
    corpCode: "00126380",
    fallbackCompanyName: "삼성전자"
  },
  "000660": {
    corpCode: "00164779",
    fallbackCompanyName: "SK하이닉스"
  },
  "373220": {
    corpCode: "01515323",
    fallbackCompanyName: "LG에너지솔루션"
  }
};

const stockDataCache: Partial<Record<StockDataLanguage, StockDataItem[]>> = {};

export async function resolveDartCompany(input: {
  companyName?: string;
  stockCode?: string;
  language?: StockDataLanguage;
}): Promise<DartCompanyResolution> {
  const language = input.language ?? "ko";

  if (input.stockCode) {
    return resolveByStockCode(input.stockCode, language);
  }

  if (!input.companyName) {
    return {
      ok: false,
      code: "MISSING_IDENTIFIER",
      message: "companyName or stockCode is required."
    };
  }

  const stock = findStockByName(input.companyName, detectStockDataLanguage(input.companyName, language));

  if (!stock) {
    return {
      ok: false,
      code: "STOCK_NOT_FOUND",
      message: "종목명을 찾을 수 없습니다. 한국어 종목명을 확인해주세요."
    };
  }

  return resolveStockDataItem(stock);
}

async function resolveByStockCode(
  stockCode: string,
  language: StockDataLanguage
): Promise<DartCompanyResolution> {
  const stock = findStockByCode(stockCode, language);

  if (stock) {
    return resolveStockDataItem(stock);
  }

  const corpCodeLookup = await getDartCorpCodeByStockCode(stockCode);

  if (corpCodeLookup.ok) {
    return {
      ok: true,
      company: {
        companyName: corpCodeLookup.entry.corpName,
        stockCode,
        corpCode: corpCodeLookup.entry.corpCode,
        market: "UNKNOWN"
      }
    };
  }

  const corpCodeMapping = DART_CORP_CODE_BY_STOCK_CODE[stockCode];

  if (!corpCodeMapping) {
    return {
      ok: false,
      code: "CORP_CODE_UNSUPPORTED",
      message: "DART corp_code 매핑이 아직 지원되지 않는 종목코드입니다."
    };
  }

  return {
    ok: true,
    company: {
      companyName: corpCodeMapping.fallbackCompanyName,
      stockCode,
      corpCode: corpCodeMapping.corpCode,
      market: "UNKNOWN"
    }
  };
}

async function resolveStockDataItem(stock: StockDataItem): Promise<DartCompanyResolution> {
  const corpCodeLookup = await getDartCorpCodeByStockCode(stock.code);

  if (corpCodeLookup.ok) {
    return {
      ok: true,
      company: {
        companyName: stock.name,
        stockCode: stock.code,
        corpCode: corpCodeLookup.entry.corpCode,
        market: stock.market
      }
    };
  }

  const corpCodeMapping = DART_CORP_CODE_BY_STOCK_CODE[stock.code];

  if (!corpCodeMapping) {
    return {
      ok: false,
      code: "CORP_CODE_UNSUPPORTED",
      message: "종목명은 찾았지만 DART corp_code 매핑을 찾을 수 없습니다.",
      stock
    };
  }

  return {
    ok: true,
    company: {
      companyName: stock.name,
      stockCode: stock.code,
      corpCode: corpCodeMapping.corpCode,
      market: stock.market
    }
  };
}

function findStockByName(
  companyName: string,
  language: StockDataLanguage
): StockDataItem | undefined {
  const normalizedCompanyName = normalizeStockName(companyName, language);

  return loadStockData(language).find(
    (stock) => normalizeStockName(stock.name, language) === normalizedCompanyName
  );
}

function findStockByCode(
  stockCode: string,
  language: StockDataLanguage
): StockDataItem | undefined {
  return loadStockData(language).find((stock) => stock.code === stockCode);
}

function loadStockData(language: StockDataLanguage): StockDataItem[] {
  if (!stockDataCache[language]) {
    const filePath = getStockDataPath(language);
    stockDataCache[language] = JSON.parse(readFileSync(filePath, "utf8")) as StockDataItem[];
  }

  return stockDataCache[language];
}

function getStockDataPath(language: StockDataLanguage): string {
  const currentDir = dirname(fileURLToPath(import.meta.url));
  const fileName = language === "ko" ? "stock_data_ko.json" : "stock_data_en.json";

  return resolve(currentDir, "../../data", fileName);
}

function detectStockDataLanguage(
  companyName: string,
  fallbackLanguage: StockDataLanguage
): StockDataLanguage {
  return isEnglishCompanyName(companyName) ? "en" : fallbackLanguage;
}

function isEnglishCompanyName(value: string): boolean {
  return /[A-Za-z]/.test(value) && !/[가-힣]/.test(value);
}

function normalizeStockName(value: string, language: StockDataLanguage): string {
  if (language === "en") {
    return value.trim().toUpperCase();
  }

  return value.replace(/\s/g, "");
}
