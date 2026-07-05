import express from "express";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { config } from "./config.js";
import { registerAnalysisTools } from "./tools/analysis.js";
import { registerDartTools } from "./tools/dart.js";
import { registerMarketTools } from "./tools/market.js";
import { registerStockTools } from "./tools/stock.js";
import { registerSystemTools } from "./tools/system.js";

function createServer() {
  const server = new McpServer(
    {
      name: "korea-stocks-mcp",
      version: "0.1.0"
    },
    {
      capabilities: {
        tools: {}
      }
    }
  );

  registerStockTools(server);
  registerMarketTools(server);
  registerDartTools(server);
  registerAnalysisTools(server);
  registerSystemTools(server);

  return server;
}

function isOriginAllowed(origin: string | undefined): boolean {
  if (!origin || config.allowedOrigins.length === 0) {
    return true;
  }

  return config.allowedOrigins.includes(origin);
}

const app = express();
app.use(express.json({ limit: "2mb" }));

app.use((req, res, next) => {
  if (!isOriginAllowed(req.header("origin"))) {
    res.status(403).json({ error: "Origin is not allowed." });
    return;
  }

  next();
});

app.get("/health", (_req, res) => {
  res.json({
    ok: true,
    status: "ok",
    server: "korea-stocks-mcp",
    version: "0.1.0",
    mcp_endpoint: config.mcpEndpoint,
    read_only: true
  });
});

app.post(config.mcpEndpoint, async (req, res) => {
  const server = createServer();
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined
  });

  res.on("close", () => {
    void transport.close();
    void server.close();
  });

  try {
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  } catch (error) {
    console.error("MCP request failed", error);
    if (!res.headersSent) {
      res.status(500).json({
        jsonrpc: "2.0",
        error: {
          code: -32603,
          message: "Internal server error"
        },
        id: null
      });
    }
  }
});

app.get(config.mcpEndpoint, (_req, res) => {
  res.status(405).json({
    error: "This stateless MCP server does not expose a standalone SSE stream."
  });
});

app.delete(config.mcpEndpoint, (_req, res) => {
  res.status(405).json({
    error: "This stateless MCP server does not use server-managed sessions."
  });
});

app.listen(config.port, config.host, () => {
  console.log(
    `Korea Stocks MCP listening on http://${config.host}:${config.port}${config.mcpEndpoint}`
  );
});
