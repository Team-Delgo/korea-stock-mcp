import type { NextFunction, Request, Response } from "express";
import type { AppConfig } from "../config.js";

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "::1"]);

export function isLoopbackOrigin(origin: string): boolean {
  try {
    const url = new URL(origin);
    return LOOPBACK_HOSTS.has(url.hostname);
  } catch {
    return false;
  }
}

export function isOriginAllowed(origin: string | undefined, config: AppConfig): boolean {
  if (!origin) {
    return true;
  }

  if (config.allowedOrigins.includes(origin)) {
    return true;
  }

  if (config.allowedOrigins.length === 0 && isLoopbackOrigin(origin)) {
    return true;
  }

  return false;
}

export function isHostAllowed(hostHeader: string | undefined, config: AppConfig): boolean {
  if (config.allowedHosts.length === 0 || !hostHeader) {
    return true;
  }

  const host = hostHeader.split(":")[0]?.toLowerCase();
  return Boolean(host && config.allowedHosts.includes(host));
}

export function hasValidBearerToken(req: Request, config: AppConfig): boolean {
  if (!config.mcpBearerToken) {
    return true;
  }

  return req.header("authorization") === `Bearer ${config.mcpBearerToken}`;
}

export function securityMiddleware(config: AppConfig) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!isHostAllowed(req.header("host"), config)) {
      res.status(403).json({ error: "Host is not allowed." });
      return;
    }

    if (!isOriginAllowed(req.header("origin"), config)) {
      res.status(403).json({ error: "Origin is not allowed." });
      return;
    }

    if (!hasValidBearerToken(req, config)) {
      res.status(401).json({ error: "Missing or invalid bearer token." });
      return;
    }

    next();
  };
}
