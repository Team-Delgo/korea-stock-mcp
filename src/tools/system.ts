import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { config } from "../config.js";
import { successEnvelope } from "../schemas/common.js";
import { jsonToolResponse } from "./helpers.js";

export function registerSystemTools(server: McpServer) {
  server.registerTool(
    "system_health",
    {
      title: "System Health",
      description: "Return basic server health and configuration status.",
      inputSchema: {}
    },
    async () => {
      return jsonToolResponse(
        successEnvelope({
          status: "ok",
          server: "korea-stocks-mcp",
          version: "0.1.0",
          endpoint: config.mcpEndpoint,
          read_only: true,
          tools_implemented: ["system_health"],
          tools_stubbed: [
            "resolve_stock",
            "get_stock_master",
            "stock_get_quote",
            "stock_get_orderbook",
            "stock_get_price_history",
            "market_get_movers",
            "dart_search_filings",
            "dart_get_company_overview",
            "dart_get_financial_statement",
            "analysis_get_stock_snapshot"
          ],
          kis_configured: Boolean(config.kis.appKey && config.kis.appSecret),
          dart_configured: Boolean(config.dart.apiKey)
        })
      );
    }
  );
}
