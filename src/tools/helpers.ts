import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ToolCallback } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ZodRawShape } from "zod";
import { notImplementedEnvelope } from "../schemas/common.js";

interface ToolDefinition {
  name: string;
  title: string;
  description: string;
  inputSchema: ZodRawShape;
}

export function jsonToolResponse(value: object, isError = false) {
  const text = JSON.stringify(value, null, 2);

  return {
    content: [{ type: "text" as const, text }],
    structuredContent: value as { [key: string]: unknown },
    isError
  };
}

export function registerNotImplementedTool(
  server: McpServer,
  definition: ToolDefinition
) {
  server.registerTool(
    definition.name,
    {
      title: definition.title,
      description: definition.description,
      inputSchema: definition.inputSchema
    },
    ((async () => {
      return jsonToolResponse(notImplementedEnvelope(definition.name), true);
    }) as ToolCallback<typeof definition.inputSchema>)
  );
}
