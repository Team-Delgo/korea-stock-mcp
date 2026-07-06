import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { getChoseong } from "es-hangul";

export interface MasterRecord {
  stock_code: string;
  name: string;
  name_en: string;
  market: string;
  market_cap: number;
}

let _master: MasterRecord[] | null = null;

export function getMaster(): MasterRecord[] {
  if (!_master) {
    const base = new URL("../../data/", import.meta.url);
    const rawKo: Array<{ code: string; name: string; market: string; marketCap: number }> =
      JSON.parse(readFileSync(fileURLToPath(new URL("stock_data_ko.json", base)), "utf-8"));
    const rawEn: Array<{ code: string; name: string }> =
      JSON.parse(readFileSync(fileURLToPath(new URL("stock_data_en.json", base)), "utf-8"));
    const enByCode = new Map(rawEn.map((r) => [r.code, r.name]));
    _master = rawKo.map((r) => ({
      stock_code: r.code,
      name: r.name,
      name_en: enByCode.get(r.code) ?? "",
      market: r.market,
      market_cap: r.marketCap,
    }));
  }
  return _master;
}

const CHOSEONG_RE = /^[ㄱ-ㅎ]+$/;

function syllableSubsequence(text: string, abbr: string): boolean {
  let i = 0;
  for (const ch of abbr) {
    while (i < text.length && text[i] !== ch) i++;
    if (i >= text.length) return false;
    i++;
  }
  return true;
}

/**
 * Returns all matching records in priority order:
 *  1. Exact 6-digit code
 *  2. Exact name (ko, then en)
 *  3. Name prefix (ko or en)
 *  4. Name substring (ko or en)
 *  5. Choseong (초성) — only when query is all Korean consonants
 *  6. Syllable subsequence (단축어, e.g. 삼전 → 삼성전자)
 *
 * Stops at the first level that yields any result.
 * Callers decide whether multiple results are "ambiguous".
 */
export function searchStocks(query: string, records: MasterRecord[]): MasterRecord[] {
  const q = query.trim();
  if (!q) return [];

  if (/^\d{6}$/.test(q)) {
    return records.filter((r) => r.stock_code === q);
  }

  const qLower = q.toLowerCase();

  const exactKo = records.filter((r) => r.name === q);
  if (exactKo.length > 0) return exactKo;

  const exactEn = records.filter((r) => r.name_en.toLowerCase() === qLower);
  if (exactEn.length > 0) return exactEn;

  const prefix = records.filter(
    (r) => r.name.startsWith(q) || r.name_en.toLowerCase().startsWith(qLower)
  );
  if (prefix.length > 0) return prefix;

  const sub = records.filter(
    (r) => r.name.includes(q) || r.name_en.toLowerCase().includes(qLower)
  );
  if (sub.length > 0) return sub;

  if (CHOSEONG_RE.test(q)) {
    const cho = records.filter((r) => getChoseong(r.name).includes(q));
    if (cho.length > 0) return cho;
  }

  if (q.length >= 2) {
    const seq = records.filter((r) => syllableSubsequence(r.name, q));
    if (seq.length > 0) return seq;
  }

  return [];
}
