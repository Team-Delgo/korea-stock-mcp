import { randomUUID } from "node:crypto";

export type EnvelopeSource = "KIS" | "DART" | "CACHE" | "COMPUTED";

export interface EnvelopeMeta {
  source: EnvelopeSource;
  source_api?: string;
  as_of?: string;
  cached?: boolean;
  cache_ttl_sec?: number;
  request_id?: string;
  raw_ref?: string;
}

export interface SuccessEnvelope<TData> {
  ok: true;
  data: TData;
  meta: EnvelopeMeta;
  warnings: string[];
}

export interface ErrorEnvelope {
  ok: false;
  error: {
    code:
      | "RATE_LIMITED"
      | "AUTH_EXPIRED"
      | "INVALID_SYMBOL"
      | "NO_DATA"
      | "UPSTREAM_ERROR"
      | "INVALID_INPUT"
      | "NOT_IMPLEMENTED";
    message: string;
    retry_after_sec?: number;
  };
  meta: EnvelopeMeta;
}

export type Envelope<TData> = SuccessEnvelope<TData> | ErrorEnvelope;

export function createMeta(
  source: EnvelopeSource = "COMPUTED",
  sourceApi = "mcp-skeleton"
): EnvelopeMeta {
  return {
    source,
    source_api: sourceApi,
    as_of: new Date().toISOString(),
    cached: false,
    request_id: `req_${randomUUID()}`
  };
}

export function successEnvelope<TData>(
  data: TData,
  meta: EnvelopeMeta = createMeta(),
  warnings: string[] = []
): SuccessEnvelope<TData> {
  return {
    ok: true,
    data,
    meta,
    warnings
  };
}

export function notImplementedEnvelope(toolName: string): ErrorEnvelope {
  return {
    ok: false,
    error: {
      code: "NOT_IMPLEMENTED",
      message: "This tool is registered but not implemented yet."
    },
    meta: createMeta("COMPUTED", toolName)
  };
}
