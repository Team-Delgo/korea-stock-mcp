import { readFileSync } from "node:fs";

export const SERVER_NAME = "korea-stocks-mcp";
export const SERVER_VERSION = readPackageVersion();

export const MCP_PROTOCOL_VERSIONS = ["2025-03-26", "2025-06-18", "2025-11-25"] as const;
export const DEFAULT_MCP_PROTOCOL_VERSION = "2025-03-26";

export const STUBBED_DATA_TOOLS = [] as const;

function readPackageVersion(): string {
  const fallback = "0.0.0";

  try {
    const packageJsonUrl = new URL("../package.json", import.meta.url);
    const packageJson = JSON.parse(readFileSync(packageJsonUrl, "utf8")) as {
      version?: unknown;
    };

    return typeof packageJson.version === "string" ? packageJson.version : fallback;
  } catch {
    return fallback;
  }
}
