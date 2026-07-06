import { describe, it, expect, vi, beforeEach } from "vitest";
import type { AppConfig } from "../src/config.js";
import { getKisAccessToken, clearKisTokenCache } from "../src/services/kis-auth.js";
import { kisGet, KisApiError } from "../src/clients/kis-rest.js";

const cfg: AppConfig = {
  host: "127.0.0.1",
  port: 3000,
  mcpEndpoint: "/mcp",
  allowedOrigins: [],
  allowedHosts: [],
  logLevel: "silent",
  cacheDbPath: "./data/test.sqlite",
  kis: {
    appKey: "test-app-key",
    appSecret: "test-app-secret",
    env: "paper",
    baseUrlReal: "https://openapi.koreainvestment.com:9443",
    baseUrlPaper: "https://openapivts.koreainvestment.com:29443",
  },
  dart: { baseUrl: "https://opendart.fss.or.kr/api" },
};

function fakeTokenRes(token = "test-token", expiresIn = 86400) {
  return {
    ok: true,
    json: async () => ({ access_token: token, expires_in: expiresIn }),
  } as unknown as Response;
}

function fakeKisRes(output: unknown, rtCd = "0", msg1 = "OK") {
  return {
    ok: true,
    json: async () => ({ rt_cd: rtCd, msg1, output }),
  } as unknown as Response;
}

// ── kis-auth ────────────────────────────────────────────────────────────────

describe("getKisAccessToken", () => {
  beforeEach(() => {
    clearKisTokenCache();
    vi.unstubAllGlobals();
  });

  it("fetches and returns access_token from KIS", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(fakeTokenRes("tok-abc")));

    const token = await getKisAccessToken(cfg);

    expect(token).toBe("tok-abc");
  });

  it("caches the token — fetch is called only once on repeated calls", async () => {
    const mockFetch = vi.fn().mockResolvedValue(fakeTokenRes());
    vi.stubGlobal("fetch", mockFetch);

    await getKisAccessToken(cfg);
    await getKisAccessToken(cfg);

    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it("refetches when cached token is within 5 min of expiry", async () => {
    const mockFetch = vi.fn()
      .mockResolvedValueOnce(fakeTokenRes("first", 60))   // 60s < 5min threshold → stale immediately
      .mockResolvedValueOnce(fakeTokenRes("second", 86400));
    vi.stubGlobal("fetch", mockFetch);

    await getKisAccessToken(cfg);
    const token = await getKisAccessToken(cfg);

    expect(mockFetch).toHaveBeenCalledTimes(2);
    expect(token).toBe("second");
  });

  it("uses paper baseUrl when env is paper", async () => {
    const mockFetch = vi.fn().mockResolvedValueOnce(fakeTokenRes());
    vi.stubGlobal("fetch", mockFetch);

    await getKisAccessToken(cfg);

    const [url] = mockFetch.mock.calls[0] as [string];
    expect(url).toContain("openapivts.koreainvestment.com");
  });

  it("uses real baseUrl when env is real", async () => {
    const realCfg = { ...cfg, kis: { ...cfg.kis, env: "real" as const } };
    const mockFetch = vi.fn().mockResolvedValueOnce(fakeTokenRes());
    vi.stubGlobal("fetch", mockFetch);

    await getKisAccessToken(realCfg);

    const [url] = mockFetch.mock.calls[0] as [string];
    expect(url).toContain("openapi.koreainvestment.com:9443");
  });

  it("throws when appKey is not configured", async () => {
    const badCfg = { ...cfg, kis: { ...cfg.kis, appKey: undefined } };

    await expect(getKisAccessToken(badCfg)).rejects.toThrow("KIS_APP_KEY");
  });

  it("throws when appSecret is not configured", async () => {
    const badCfg = { ...cfg, kis: { ...cfg.kis, appSecret: undefined } };

    await expect(getKisAccessToken(badCfg)).rejects.toThrow("KIS_APP_SECRET");
  });

  it("throws on HTTP error without leaking credentials", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValueOnce({ ok: false, status: 500 } as Response)
    );

    const err = await getKisAccessToken(cfg).catch((e: Error) => e) as Error;

    expect(err).toBeInstanceOf(Error);
    expect(err.message).not.toContain(cfg.kis.appKey);
    expect(err.message).not.toContain(cfg.kis.appSecret);
  });

  it("throws when response is missing access_token", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => ({}),
    } as unknown as Response));

    await expect(getKisAccessToken(cfg)).rejects.toThrow("access_token");
  });
});

// ── kis-rest ────────────────────────────────────────────────────────────────

describe("kisGet", () => {
  beforeEach(() => {
    clearKisTokenCache();
    vi.unstubAllGlobals();
  });

  it("sends Authorization, appkey, appsecret, custtype headers", async () => {
    const mockFetch = vi.fn()
      .mockResolvedValueOnce(fakeTokenRes("bearer-tok"))
      .mockResolvedValueOnce(fakeKisRes({}));
    vi.stubGlobal("fetch", mockFetch);

    await kisGet("/some-path", "FHKST01010100", {}, cfg);

    const [, options] = mockFetch.mock.calls[1] as [string, RequestInit & { headers: Record<string, string> }];
    expect(options.headers["Authorization"]).toBe("Bearer bearer-tok");
    expect(options.headers["appkey"]).toBe("test-app-key");
    expect(options.headers["custtype"]).toBe("P");
    expect(options.headers["appsecret"]).toBeDefined();
  });

  it("switches F→V in tr_id for paper mode", async () => {
    const mockFetch = vi.fn()
      .mockResolvedValueOnce(fakeTokenRes())
      .mockResolvedValueOnce(fakeKisRes({}));
    vi.stubGlobal("fetch", mockFetch);

    await kisGet("/path", "FHKST01010100", {}, cfg);

    const [, options] = mockFetch.mock.calls[1] as [string, RequestInit & { headers: Record<string, string> }];
    expect(options.headers["tr_id"]).toBe("VHKST01010100");
  });

  it("keeps tr_id unchanged in real mode", async () => {
    const realCfg = { ...cfg, kis: { ...cfg.kis, env: "real" as const } };
    const mockFetch = vi.fn()
      .mockResolvedValueOnce(fakeTokenRes())
      .mockResolvedValueOnce(fakeKisRes({}));
    vi.stubGlobal("fetch", mockFetch);

    await kisGet("/path", "FHKST01010100", {}, realCfg);

    const [, options] = mockFetch.mock.calls[1] as [string, RequestInit & { headers: Record<string, string> }];
    expect(options.headers["tr_id"]).toBe("FHKST01010100");
  });

  it("passes query params in the URL", async () => {
    const mockFetch = vi.fn()
      .mockResolvedValueOnce(fakeTokenRes())
      .mockResolvedValueOnce(fakeKisRes({}));
    vi.stubGlobal("fetch", mockFetch);

    await kisGet("/path", "FHKST01010100", { fid_input_iscd: "005930", fid_cond_mrkt_div_code: "J" }, cfg);

    const [url] = mockFetch.mock.calls[1] as [string];
    expect(url).toContain("fid_input_iscd=005930");
    expect(url).toContain("fid_cond_mrkt_div_code=J");
  });

  it("throws on non-200 HTTP status", async () => {
    vi.stubGlobal("fetch", vi.fn()
      .mockResolvedValueOnce(fakeTokenRes())
      .mockResolvedValueOnce({ ok: false, status: 429 } as Response)
    );

    await expect(kisGet("/path", "FHKST01010100", {}, cfg)).rejects.toThrow("429");
  });

  it("throws KisApiError when rt_cd is not 0", async () => {
    vi.stubGlobal("fetch", vi.fn()
      .mockResolvedValueOnce(fakeTokenRes())
      .mockResolvedValueOnce(fakeKisRes({}, "1", "종목코드 오류"))
    );

    const err = await kisGet("/path", "FHKST01010100", {}, cfg).catch((e) => e);

    expect(err).toBeInstanceOf(KisApiError);
    expect((err as KisApiError).rtCd).toBe("1");
    expect((err as KisApiError).message).toBe("종목코드 오류");
  });
});
