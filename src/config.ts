import dotenv from "dotenv";

dotenv.config();

export type KisEnv = "paper" | "real";

export interface AppConfig {
  host: string;
  port: number;
  mcpEndpoint: string;
  allowedOrigins: string[];
  logLevel: string;
  cacheDbPath: string;
  kis: {
    appKey?: string;
    appSecret?: string;
    env: KisEnv;
    baseUrlReal: string;
    baseUrlPaper: string;
  };
  dart: {
    apiKey?: string;
    baseUrl: string;
  };
}

function readInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;

  const parsed = Number.parseInt(raw, 10);
  if (Number.isNaN(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive integer.`);
  }

  return parsed;
}

function readList(name: string): string[] {
  return (process.env[name] ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
}

function readKisEnv(): KisEnv {
  const raw = process.env.KIS_ENV ?? "paper";
  if (raw !== "paper" && raw !== "real") {
    throw new Error("KIS_ENV must be either 'paper' or 'real'.");
  }

  return raw;
}

function normalizeEndpoint(endpoint: string): string {
  const trimmed = endpoint.trim();
  if (!trimmed.startsWith("/")) {
    return `/${trimmed}`;
  }

  return trimmed;
}

export const config: AppConfig = {
  host: process.env.HOST ?? "127.0.0.1",
  port: readInt("PORT", 3000),
  mcpEndpoint: normalizeEndpoint(process.env.MCP_ENDPOINT ?? "/mcp"),
  allowedOrigins: readList("ALLOWED_ORIGINS"),
  logLevel: process.env.LOG_LEVEL ?? "info",
  cacheDbPath: process.env.CACHE_DB_PATH ?? "./data/kis_dart_cache.sqlite",
  kis: {
    appKey: process.env.KIS_APP_KEY,
    appSecret: process.env.KIS_APP_SECRET,
    env: readKisEnv(),
    baseUrlReal:
      process.env.KIS_BASE_URL_REAL ?? "https://openapi.koreainvestment.com:9443",
    baseUrlPaper:
      process.env.KIS_BASE_URL_PAPER ??
      "https://openapivts.koreainvestment.com:29443"
  },
  dart: {
    apiKey: process.env.DART_API_KEY,
    baseUrl: process.env.DART_BASE_URL ?? "https://opendart.fss.or.kr/api"
  }
};
