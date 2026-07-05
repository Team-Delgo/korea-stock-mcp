import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { registerNotImplementedTool } from "./helpers.js";

export function registerStockTools(server: McpServer) {
  registerNotImplementedTool(server, {
    name: "resolve_stock",
    title: "Resolve Stock",
    description:
      "Resolve a Korean stock name or stock code to KIS stock_code and DART corp_code.",
    inputSchema: {
      query: z.string().min(1),
      market: z.enum(["KOSPI", "KOSDAQ", "KONEX", "ALL"]).default("ALL"),
      limit: z.number().int().positive().max(50).default(10)
    }
  });

  registerNotImplementedTool(server, {
    name: "get_stock_master",
    title: "Get Stock Master",
    description: "List Korean listed stock master records.",
    inputSchema: {
      market: z.enum(["KOSPI", "KOSDAQ", "KONEX", "ALL"]).default("ALL"),
      include_delisted: z.boolean().default(false),
      updated_after: z.string().optional()
    }
  });

  registerNotImplementedTool(server, {
    name: "stock_get_quote",
    title: "Get Stock Quote",
    description: "Get a current quote for a Korean stock through KIS.",
    inputSchema: {
      stock_code: z.string().regex(/^\d{6}$/),
      market_div_code: z.string().default("J"),
      include_extended: z.boolean().default(true)
    }
  });

  registerNotImplementedTool(server, {
    name: "stock_get_orderbook",
    title: "Get Stock Orderbook",
    description: "Get bid/ask orderbook and expected execution data for a stock.",
    inputSchema: {
      stock_code: z.string().regex(/^\d{6}$/),
      market_div_code: z.string().default("J"),
      depth: z.number().int().positive().max(10).default(10)
    }
  });

  registerNotImplementedTool(server, {
    name: "stock_get_price_history",
    title: "Get Stock Price History",
    description: "Get daily, weekly, monthly, or yearly OHLCV history for a stock.",
    inputSchema: {
      stock_code: z.string().regex(/^\d{6}$/),
      period: z.enum(["D", "W", "M", "Y"]).default("D"),
      start_date: z.string().optional(),
      end_date: z.string().optional(),
      adjusted: z.boolean().default(true),
      limit: z.number().int().positive().max(500).default(100)
    }
  });
}
