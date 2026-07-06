import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { AppConfig } from "../config.js";
import { config as defaultConfig } from "../config.js";
import { SERVER_NAME, SERVER_VERSION, STUBBED_DATA_TOOLS } from "../constants.js";
import { envelopeOutputSchema, successEnvelope } from "../schemas/common.js";
import { jsonToolResponse } from "./helpers.js";

export function registerSystemTools(
  server: McpServer,
  config: AppConfig = defaultConfig
) {
  server.registerTool(
    "system_health",
    {
      title: "System Health",
      description: "Return basic server health and configuration status.",
      inputSchema: {},
      outputSchema: envelopeOutputSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false
      }
    },
    async () => {
      return jsonToolResponse(
        successEnvelope({
          status: "ok",
          server: SERVER_NAME,
          version: SERVER_VERSION,
          endpoint: config.mcpEndpoint,
          read_only: true,
          tools_implemented: ["system_health"],
          tools_stubbed: STUBBED_DATA_TOOLS,
          kis_configured: Boolean(config.kis.appKey && config.kis.appSecret),
          dart_configured: Boolean(config.dart.apiKey),
          bearer_auth_enabled: Boolean(config.mcpBearerToken),
          allowed_origins_configured: config.allowedOrigins.length,
          allowed_hosts_configured: config.allowedHosts.length
        })
      );
    }
  );
}
