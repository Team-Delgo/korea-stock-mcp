import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { registerNotImplementedTool } from "./helpers.js";

export function registerAnalysisTools(server: McpServer) {
  registerNotImplementedTool(server, {
    name: "analysis_get_stock_snapshot",
    title: "Get Stock Snapshot",
    description:
      "Build a read-only stock snapshot from KIS quote/history data and DART disclosure/financial data.",
    inputSchema: {
      query: z.string().min(1),
      history_days: z.number().int().positive().max(1000).default(120),
      include_financials: z.boolean().default(true),
      include_recent_filings: z.boolean().default(true),
      filing_days: z.number().int().positive().max(3650).default(30)
    }
  });
}
