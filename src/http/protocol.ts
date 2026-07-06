import type { NextFunction, Request, Response } from "express";
import {
  DEFAULT_MCP_PROTOCOL_VERSION,
  MCP_PROTOCOL_VERSIONS
} from "../constants.js";

const supportedProtocolVersions = new Set<string>(MCP_PROTOCOL_VERSIONS);

export function jsonRpcError(status: number, code: number, message: string) {
  return {
    status,
    body: {
      jsonrpc: "2.0",
      error: {
        code,
        message
      },
      id: null
    }
  };
}

export function validateMcpProtocolVersion(req: Request, res: Response, next: NextFunction) {
  const protocolVersion =
    req.header("mcp-protocol-version") ?? DEFAULT_MCP_PROTOCOL_VERSION;

  if (!supportedProtocolVersions.has(protocolVersion)) {
    const error = jsonRpcError(
      400,
      -32000,
      `Unsupported MCP protocol version: ${protocolVersion}`
    );
    res.status(error.status).json(error.body);
    return;
  }

  next();
}

export function validateStreamableHttpAccept(req: Request, res: Response, next: NextFunction) {
  const accept = req.header("accept") ?? "";
  const acceptsJson = accept.includes("application/json") || accept.includes("*/*");
  const acceptsSse = accept.includes("text/event-stream") || accept.includes("*/*");

  if (!acceptsJson || !acceptsSse) {
    const error = jsonRpcError(
      406,
      -32000,
      "Streamable HTTP POST requests must accept both application/json and text/event-stream."
    );
    res.status(error.status).json(error.body);
    return;
  }

  next();
}
