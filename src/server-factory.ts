import express, { type Express } from "express";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import type { AppConfig } from "./config.js";
import { config as defaultConfig } from "./config.js";
import { SERVER_NAME, SERVER_VERSION } from "./constants.js";
import { applyCorsHeaders, securityMiddleware } from "./http/security.js";
import {
  jsonRpcError,
  validateMcpProtocolVersion,
  validateStreamableHttpAccept
} from "./http/protocol.js";
import { registerAnalysisTools } from "./tools/analysis.js";
import { registerDartTools } from "./tools/dart.js";
import { registerEtfTools } from "./tools/etf.js";
import { registerMarketTools } from "./tools/market.js";
import { registerStockTools } from "./tools/stock.js";
import { registerSystemTools } from "./tools/system.js";

export function createMcpServer(appConfig: AppConfig = defaultConfig) {
  const server = new McpServer(
    {
      name: SERVER_NAME,
      version: SERVER_VERSION
    },
    {
      capabilities: {
        tools: {}
      }
    }
  );

  registerStockTools(server, appConfig);
  registerEtfTools(server, appConfig);
  registerMarketTools(server, appConfig);
  registerDartTools(server);
  registerAnalysisTools(server);
  registerSystemTools(server, appConfig);

  return server;
}

export function createExpressApp(appConfig: AppConfig = defaultConfig): Express {
  const app = express();

  app.disable("x-powered-by");
  app.use(express.json({ limit: "2mb" }));

  app.get("/health", (_req, res) => {
    res.json({
      ok: true,
      status: "ok",
      server: SERVER_NAME,
      version: SERVER_VERSION,
      mcp_endpoint: appConfig.mcpEndpoint,
      read_only: true
    });
  });

  app.options(appConfig.mcpEndpoint, securityMiddleware(appConfig), (req, res) => {
    applyCorsHeaders(req, res, appConfig);
    res.status(204).send();
  });

  app.post(
    appConfig.mcpEndpoint,
    securityMiddleware(appConfig),
    validateMcpProtocolVersion,
    validateStreamableHttpAccept,
    async (req, res) => {
      const server = createMcpServer(appConfig);
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
        console.error("MCP request failed", sanitizeError(error));
        if (!res.headersSent) {
          const response = jsonRpcError(500, -32603, "Internal server error");
          res.status(response.status).json(response.body);
        }
      }
    }
  );

  app.get(
    appConfig.mcpEndpoint,
    securityMiddleware(appConfig),
    validateMcpProtocolVersion,
    (_req, res) => {
      res.setHeader("Allow", "POST, GET, DELETE");
      res.status(405).json({
        error: "This stateless MCP server does not expose a standalone SSE stream."
      });
    }
  );

  app.delete(
    appConfig.mcpEndpoint,
    securityMiddleware(appConfig),
    validateMcpProtocolVersion,
    (_req, res) => {
      res.setHeader("Allow", "POST, GET, DELETE");
      res.status(405).json({
        error: "This stateless MCP server does not use server-managed sessions."
      });
    }
  );

  app.use((error: unknown, _req: express.Request, res: express.Response, next: express.NextFunction) => {
    if (res.headersSent) {
      next(error);
      return;
    }

    if (isBodyParserError(error)) {
      const response = jsonRpcError(400, -32700, "Invalid JSON request body.");
      res.status(response.status).json(response.body);
      return;
    }

    next(error);
  });

  return app;
}

function isBodyParserError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "type" in error &&
    (error as { type?: unknown }).type === "entity.parse.failed"
  );
}

function sanitizeError(error: unknown) {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
      stack: process.env.NODE_ENV === "production" ? undefined : error.stack
    };
  }

  return { message: "Unknown error" };
}
