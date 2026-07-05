import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { registerNotImplementedTool } from "./helpers.js";

export function registerDartTools(server: McpServer) {
  registerNotImplementedTool(server, {
    name: "dart_search_filings",
    title: "Search DART Filings",
    description: "Search DART disclosures by corporation, stock, date, and type.",
    inputSchema: {
      corp_code: z.string().optional(),
      stock_code: z.string().regex(/^\d{6}$/).optional(),
      start_date: z.string().optional(),
      end_date: z.string().optional(),
      disclosure_type: z
        .enum(["A", "B", "C", "D", "E", "F", "G", "H", "I", "J", "ALL"])
        .default("ALL"),
      final_only: z.boolean().default(true),
      page: z.number().int().positive().default(1),
      page_size: z.number().int().positive().max(100).default(20)
    }
  });

  registerNotImplementedTool(server, {
    name: "dart_get_company_overview",
    title: "Get DART Company Overview",
    description: "Get company overview information from DART.",
    inputSchema: {
      corp_code: z.string().min(1)
    }
  });

  registerNotImplementedTool(server, {
    name: "dart_get_financial_statement",
    title: "Get DART Financial Statement",
    description: "Get DART financial statements for a corporation and report code.",
    inputSchema: {
      corp_code: z.string().min(1),
      business_year: z.string().regex(/^\d{4}$/),
      report_code: z.enum(["11013", "11012", "11014", "11011"]),
      statement_scope: z.enum(["major_accounts", "full"]).default("major_accounts"),
      fs_div: z.enum(["CFS", "OFS", "ALL"]).default("CFS")
    }
  });
}
