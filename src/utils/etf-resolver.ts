import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

export interface EtfMasterRecord {
  stock_code: string;
  name: string;
}

let _etfMaster: EtfMasterRecord[] | null = null;

export function getEtfMaster(): EtfMasterRecord[] {
  if (!_etfMaster) {
    const base = new URL("../../data/", import.meta.url);
    const raw: Array<{ code: string; name: string }> =
      JSON.parse(readFileSync(fileURLToPath(new URL("etf_data.json", base)), "utf-8"));
    _etfMaster = raw.map((r) => ({ stock_code: r.code, name: r.name }));
  }
  return _etfMaster;
}
