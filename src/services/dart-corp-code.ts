import { unzipSync } from "fflate";
import { XMLParser } from "fast-xml-parser";
import { config as defaultConfig } from "../config.js";

const CORP_CODE_CACHE_TTL_MS = 24 * 60 * 60 * 1000;

export interface DartCorpCodeEntry {
  corpCode: string;
  corpName: string;
  corpEngName?: string;
  stockCode: string;
  modifyDate: string;
}

export type DartCorpCodeLookupResult =
  | {
      ok: true;
      entry: DartCorpCodeEntry;
      cached: boolean;
    }
  | {
      ok: false;
      code: "MISSING_API_KEY" | "DOWNLOAD_FAILED" | "PARSE_FAILED" | "NOT_FOUND";
      message: string;
    };

export interface DartCorpCodeServiceOptions {
  apiKey?: string;
  baseUrl?: string;
  fetcher?: typeof fetch;
  now?: () => number;
}

interface DartCorpCodeCache {
  loadedAt: number;
  expiresAt: number;
  byStockCode: Map<string, DartCorpCodeEntry>;
}

let corpCodeCache: DartCorpCodeCache | undefined;
let loadPromise: Promise<Map<string, DartCorpCodeEntry>> | undefined;

export async function getDartCorpCodeByStockCode(
  stockCode: string,
  options: DartCorpCodeServiceOptions = {}
): Promise<DartCorpCodeLookupResult> {
  try {
    const now = options.now?.() ?? Date.now();
    const byStockCode = await loadDartCorpCodeMap(options, now);
    const entry = byStockCode.get(stockCode);

    if (!entry) {
      return {
        ok: false,
        code: "NOT_FOUND",
        message: "OpenDART corpCode data does not contain the requested stock code."
      };
    }

    return {
      ok: true,
      entry,
      cached: Boolean(corpCodeCache && now < corpCodeCache.expiresAt)
    };
  } catch (error) {
    return toLookupError(error);
  }
}

export function parseDartCorpCodeXml(xml: string): DartCorpCodeEntry[] {
  const parser = new XMLParser({
    ignoreAttributes: true,
    parseTagValue: false,
    trimValues: true
  });
  const payload = parser.parse(xml) as {
    result?: {
      list?: unknown;
    };
  };
  const rawList = payload.result?.list;
  const list = Array.isArray(rawList) ? rawList : rawList ? [rawList] : [];

  return list
    .map((item) => normalizeCorpCodeEntry(item))
    .filter((entry): entry is DartCorpCodeEntry => Boolean(entry));
}

export function parseDartCorpCodeZip(zipBytes: Uint8Array): DartCorpCodeEntry[] {
  const files = unzipSync(zipBytes);
  const xmlFileName = Object.keys(files).find((fileName) =>
    fileName.toLowerCase().endsWith(".xml")
  );

  if (!xmlFileName) {
    throw new Error("OpenDART corpCode ZIP did not contain an XML file.");
  }

  const xml = new TextDecoder("utf-8").decode(files[xmlFileName]);
  return parseDartCorpCodeXml(xml);
}

export function resetDartCorpCodeCacheForTest(): void {
  corpCodeCache = undefined;
  loadPromise = undefined;
}

export function setDartCorpCodeCacheForTest(entries: DartCorpCodeEntry[]): void {
  const now = Date.now();
  corpCodeCache = {
    loadedAt: now,
    expiresAt: now + CORP_CODE_CACHE_TTL_MS,
    byStockCode: new Map(entries.map((entry) => [entry.stockCode, entry]))
  };
  loadPromise = undefined;
}

async function loadDartCorpCodeMap(
  options: DartCorpCodeServiceOptions,
  now: number
): Promise<Map<string, DartCorpCodeEntry>> {
  if (corpCodeCache && now < corpCodeCache.expiresAt) {
    return corpCodeCache.byStockCode;
  }

  if (!loadPromise) {
    loadPromise = downloadAndParseDartCorpCodes(options)
      .then((entries) => {
        const loadedAt = options.now?.() ?? Date.now();
        const byStockCode = new Map(entries.map((entry) => [entry.stockCode, entry]));
        corpCodeCache = {
          loadedAt,
          expiresAt: loadedAt + CORP_CODE_CACHE_TTL_MS,
          byStockCode
        };

        return byStockCode;
      })
      .finally(() => {
        loadPromise = undefined;
      });
  }

  try {
    return await loadPromise;
  } catch (error) {
    if (corpCodeCache) {
      return corpCodeCache.byStockCode;
    }

    throw error;
  }
}

async function downloadAndParseDartCorpCodes(
  options: DartCorpCodeServiceOptions
): Promise<DartCorpCodeEntry[]> {
  const apiKey = options.apiKey ?? defaultConfig.dart.apiKey;

  if (!apiKey) {
    throw new DartCorpCodeServiceError(
      "MISSING_API_KEY",
      "DART_API_KEY is not configured; OpenDART corpCode download was skipped."
    );
  }

  const baseUrl = options.baseUrl ?? defaultConfig.dart.baseUrl;
  const url = new URL("corpCode.xml", ensureTrailingSlash(baseUrl));
  url.searchParams.set("crtfc_key", apiKey);

  let response: Response;
  try {
    response = await (options.fetcher ?? fetch)(url);
  } catch {
    throw new DartCorpCodeServiceError(
      "DOWNLOAD_FAILED",
      "Could not download OpenDART corpCode data."
    );
  }

  if (!response.ok) {
    throw new DartCorpCodeServiceError(
      "DOWNLOAD_FAILED",
      `OpenDART corpCode download returned HTTP ${response.status}.`
    );
  }

  try {
    return parseDartCorpCodeZip(new Uint8Array(await response.arrayBuffer()));
  } catch {
    throw new DartCorpCodeServiceError(
      "PARSE_FAILED",
      "Could not parse OpenDART corpCode ZIP/XML data."
    );
  }
}

function normalizeCorpCodeEntry(item: unknown): DartCorpCodeEntry | undefined {
  if (!item || typeof item !== "object") return undefined;

  const source = item as Record<string, unknown>;
  const stockCode = readString(source.stock_code);

  if (!/^\d{6}$/.test(stockCode)) {
    return undefined;
  }

  const corpCode = readString(source.corp_code);
  const corpName = readString(source.corp_name);

  if (!/^\d{8}$/.test(corpCode) || !corpName) {
    return undefined;
  }

  return {
    corpCode,
    corpName,
    corpEngName: readString(source.corp_eng_name) || undefined,
    stockCode,
    modifyDate: readString(source.modify_date)
  };
}

function readString(value: unknown): string {
  if (value === undefined || value === null) return "";
  return String(value).trim();
}

function ensureTrailingSlash(value: string): string {
  return value.endsWith("/") ? value : `${value}/`;
}

function toLookupError(error: unknown): DartCorpCodeLookupResult {
  if (error instanceof DartCorpCodeServiceError) {
    return {
      ok: false,
      code: error.code,
      message: error.message
    };
  }

  return {
    ok: false,
    code: "PARSE_FAILED",
    message: "Unexpected error while loading OpenDART corpCode data."
  };
}

class DartCorpCodeServiceError extends Error {
  constructor(
    public readonly code: Exclude<DartCorpCodeLookupResult, { ok: true }>["code"],
    message: string
  ) {
    super(message);
    this.name = "DartCorpCodeServiceError";
  }
}
