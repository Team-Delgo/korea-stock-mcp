import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { registerNotImplementedTool } from "./helpers.js";

export function registerMarketTools(server: McpServer) {
  registerNotImplementedTool(server, {
    name: "market_get_movers",
    title: "Get Market Movers",
    description:
      "Get market rankings by volume, change rate, market cap, trading value, or related ranking types.",
    inputSchema: {
      ranking_type: z.enum([
        "volume",
        "change_rate",
        "market_cap",
        "dividend_yield",
        "short_sale",
        "credit_balance",
        "trading_value",
        "new_high_low"
      ]),
      market: z.enum(["KOSPI", "KOSDAQ", "ALL"]).default("ALL"),
      direction: z.enum(["top", "bottom"]).default("top"),
      limit: z.number().int().positive().max(100).default(50)
    }
  });
}
