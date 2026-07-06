import { describe, expect, it } from "vitest";
import request from "supertest";
import type { AppConfig } from "../src/config.js";
import { createExpressApp } from "../src/server-factory.js";

const baseConfig: AppConfig = {
  host: "127.0.0.1",
  port: 3000,
  mcpEndpoint: "/mcp",
  allowedOrigins: [],
  allowedHosts: [],
  logLevel: "silent",
  cacheDbPath: "./data/test.sqlite",
  kis: {
    env: "paper",
    baseUrlReal: "https://openapi.koreainvestment.com:9443",
    baseUrlPaper: "https://openapivts.koreainvestment.com:29443"
  },
  dart: {
    baseUrl: "https://opendart.fss.or.kr/api"
  }
};

const streamableHttpAccept = "application/json, text/event-stream";

function parseSseJson(text: string) {
  const dataLine = text
    .split("\n")
    .find((line) => line.startsWith("data: "));

  if (!dataLine) {
    throw new Error(`No SSE data line found in response: ${text}`);
  }

  return JSON.parse(dataLine.slice("data: ".length));
}

describe("MCP HTTP server", () => {
  it("returns a public health response without Express fingerprinting", async () => {
    const app = createExpressApp(baseConfig);

    const response = await request(app).get("/health").expect(200);

    expect(response.body).toMatchObject({
      ok: true,
      status: "ok",
      server: "korea-stocks-mcp",
      mcp_endpoint: "/mcp",
      read_only: true
    });
    expect(response.header["x-powered-by"]).toBeUndefined();
  });

  it("lists the expected read-only tools and no trading/account tools", async () => {
    const app = createExpressApp(baseConfig);

    const response = await request(app)
      .post("/mcp")
      .set("Accept", streamableHttpAccept)
      .send({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/list",
        params: {}
      })
      .expect(200);

    const payload = parseSseJson(response.text);
    const toolNames = payload.result.tools.map((tool: { name: string }) => tool.name);

    expect(toolNames).toEqual([
      "resolve_stock",
      "get_stock_master",
      "stock_get_quote",
      "stock_get_orderbook",
      "stock_get_price_history",
      "market_get_movers",
      "dart_search_filings",
      "dart_get_company_overview",
      "dart_get_financial_statement",
      "analysis_get_stock_snapshot",
      "system_health"
    ]);
    expect(toolNames.some((name: string) => name.startsWith("account_"))).toBe(false);
    expect(toolNames.some((name: string) => name.startsWith("order_"))).toBe(false);
    expect(payload.result.tools[0].annotations).toMatchObject({
      readOnlyHint: true,
      destructiveHint: false
    });
    expect(payload.result.tools[0].outputSchema).toMatchObject({
      type: "object",
      properties: {
        ok: {
          type: "boolean"
        },
        meta: {
          type: "object"
        }
      },
      required: ["ok", "meta"]
    });
  });

  it("returns NOT_IMPLEMENTED for stubbed data tools", async () => {
    const app = createExpressApp(baseConfig);

    const response = await request(app)
      .post("/mcp")
      .set("Accept", streamableHttpAccept)
      .send({
        jsonrpc: "2.0",
        id: 2,
        method: "tools/call",
        params: {
          name: "stock_get_quote",
          arguments: {
            stock_code: "005930"
          }
        }
      })
      .expect(200);

    const payload = parseSseJson(response.text);

    expect(payload.result.isError).toBe(true);
    expect(payload.result.structuredContent).toMatchObject({
      ok: false,
      error: {
        code: "NOT_IMPLEMENTED",
        message: "This tool is registered but not implemented yet."
      }
    });
  });

  it("rejects browser origins unless they are loopback or explicitly allowed", async () => {
    const app = createExpressApp(baseConfig);

    await request(app)
      .post("/mcp")
      .set("Origin", "https://evil.example")
      .set("Accept", streamableHttpAccept)
      .send({ jsonrpc: "2.0", id: 3, method: "tools/list", params: {} })
      .expect(403);

    await request(app)
      .post("/mcp")
      .set("Origin", "http://localhost:5173")
      .set("Accept", streamableHttpAccept)
      .send({ jsonrpc: "2.0", id: 4, method: "tools/list", params: {} })
      .expect(200);
  });

  it("requires bearer auth only for MCP endpoints when configured", async () => {
    const app = createExpressApp({
      ...baseConfig,
      mcpBearerToken: "secret-token"
    });

    await request(app).get("/health").expect(200);

    await request(app)
      .post("/mcp")
      .set("Accept", streamableHttpAccept)
      .send({ jsonrpc: "2.0", id: 5, method: "tools/list", params: {} })
      .expect(401);

    await request(app)
      .post("/mcp")
      .set("Authorization", "Bearer secret-token")
      .set("Accept", streamableHttpAccept)
      .send({ jsonrpc: "2.0", id: 6, method: "tools/list", params: {} })
      .expect(200);
  });

  it("validates MCP protocol version and Streamable HTTP Accept header", async () => {
    const app = createExpressApp(baseConfig);

    await request(app)
      .post("/mcp")
      .set("Accept", streamableHttpAccept)
      .set("MCP-Protocol-Version", "2099-01-01")
      .send({ jsonrpc: "2.0", id: 7, method: "tools/list", params: {} })
      .expect(400);

    await request(app)
      .post("/mcp")
      .set("Accept", "application/json")
      .send({ jsonrpc: "2.0", id: 8, method: "tools/list", params: {} })
      .expect(406);
  });

  it("returns 405 for standalone GET and DELETE on the stateless endpoint", async () => {
    const app = createExpressApp(baseConfig);

    await request(app)
      .get("/mcp")
      .set("Accept", "text/event-stream")
      .expect(405);

    await request(app).delete("/mcp").expect(405);
  });

  it("handles MCP CORS preflight only for allowed origins", async () => {
    const app = createExpressApp({
      ...baseConfig,
      allowedOrigins: ["https://playmcp.example"]
    });

    const allowed = await request(app)
      .options("/mcp")
      .set("Origin", "https://playmcp.example")
      .set("Access-Control-Request-Method", "POST")
      .expect(204);

    expect(allowed.header["access-control-allow-origin"]).toBe(
      "https://playmcp.example"
    );
    expect(allowed.header["access-control-allow-headers"]).toContain(
      "MCP-Protocol-Version"
    );

    await request(app)
      .options("/mcp")
      .set("Origin", "https://evil.example")
      .set("Access-Control-Request-Method", "POST")
      .expect(403);
  });
});
