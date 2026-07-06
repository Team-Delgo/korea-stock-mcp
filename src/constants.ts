export const SERVER_NAME = "korea-stocks-mcp";
export const SERVER_VERSION = "0.1.0";

export const MCP_PROTOCOL_VERSIONS = ["2025-03-26", "2025-06-18", "2025-11-25"] as const;
export const DEFAULT_MCP_PROTOCOL_VERSION = "2025-03-26";

export const STUBBED_DATA_TOOLS = [
  "dart_search_filings",
  "dart_get_company_overview",
  "analysis_get_stock_snapshot"
] as const;
