import { afterEach, describe, expect, it, vi } from "vitest";
import { DartClient } from "../src/clients/dart.js";

describe("DART client company overview", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("calls company.json with the API key and corp code", async () => {
    const fetchMock = vi.fn(async () =>
      Response.json({
        status: "000",
        message: "정상",
        corp_name: "삼성전자",
        corp_cls: "Y"
      })
    );
    vi.stubGlobal("fetch", fetchMock);

    const client = new DartClient({
      apiKey: "test-key",
      baseUrl: "https://example.test/api"
    });

    const result = await client.getCompanyOverview({ corpCode: "00126380" });
    const calledUrl = new URL(String(fetchMock.mock.calls[0][0]));

    expect(calledUrl.href).toBe(
      "https://example.test/api/company.json?crtfc_key=test-key&corp_code=00126380"
    );
    expect(result).toMatchObject({
      status: "000",
      corp_name: "삼성전자"
    });
  });

  it("does not call fetch when the API key is missing", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const client = new DartClient({
      apiKey: "",
      baseUrl: "https://example.test/api"
    });

    await expect(client.getCompanyOverview({ corpCode: "00126380" })).rejects.toMatchObject({
      code: "MISSING_API_KEY"
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([
    ["013", "NO_DATA"],
    ["020", "RATE_LIMITED"],
    ["010", "MISSING_API_KEY"]
  ])("maps OpenDART status %s to %s", async (status, code) => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({
          status,
          message: "OpenDART error"
        })
      )
    );

    const client = new DartClient({
      apiKey: "test-key",
      baseUrl: "https://example.test/api"
    });

    await expect(client.getCompanyOverview({ corpCode: "00126380" })).rejects.toMatchObject({
      code
    });
  });
});
