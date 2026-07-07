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

describe("DART client filings search", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("calls list.json with mapped search parameters and omits ALL disclosure type", async () => {
    const fetchMock = vi.fn(async () =>
      Response.json({
        status: "000",
        message: "정상",
        page_no: 2,
        page_count: 50,
        total_count: 0,
        total_page: 0,
        list: []
      })
    );
    vi.stubGlobal("fetch", fetchMock);

    const client = new DartClient({
      apiKey: "test-key",
      baseUrl: "https://example.test/api"
    });

    await client.searchFilings({
      corpCode: "00126380",
      startDate: "20240101",
      endDate: "20241231",
      disclosureType: "ALL",
      finalOnly: true,
      page: 2,
      pageSize: 50
    });

    const calledUrl = new URL(String(fetchMock.mock.calls[0][0]));

    expect(calledUrl.pathname).toBe("/api/list.json");
    expect(calledUrl.searchParams.get("crtfc_key")).toBe("test-key");
    expect(calledUrl.searchParams.get("corp_code")).toBe("00126380");
    expect(calledUrl.searchParams.get("bgn_de")).toBe("20240101");
    expect(calledUrl.searchParams.get("end_de")).toBe("20241231");
    expect(calledUrl.searchParams.get("last_reprt_at")).toBe("Y");
    expect(calledUrl.searchParams.get("pblntf_ty")).toBeNull();
    expect(calledUrl.searchParams.get("page_no")).toBe("2");
    expect(calledUrl.searchParams.get("page_count")).toBe("50");
  });

  it("sends disclosure type when it is not ALL", async () => {
    const fetchMock = vi.fn(async () =>
      Response.json({
        status: "000",
        message: "정상",
        list: []
      })
    );
    vi.stubGlobal("fetch", fetchMock);

    const client = new DartClient({
      apiKey: "test-key",
      baseUrl: "https://example.test/api"
    });

    await client.searchFilings({
      corpCode: "00126380",
      disclosureType: "A",
      finalOnly: false,
      page: 1,
      pageSize: 20
    });

    const calledUrl = new URL(String(fetchMock.mock.calls[0][0]));

    expect(calledUrl.searchParams.get("pblntf_ty")).toBe("A");
    expect(calledUrl.searchParams.get("last_reprt_at")).toBe("N");
  });

  it("maps OpenDART filings errors through DartClientError", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({
          status: "020",
          message: "OpenDART error"
        })
      )
    );

    const client = new DartClient({
      apiKey: "test-key",
      baseUrl: "https://example.test/api"
    });

    await expect(
      client.searchFilings({
        corpCode: "00126380",
        disclosureType: "ALL",
        finalOnly: true,
        page: 1,
        pageSize: 20
      })
    ).rejects.toMatchObject({
      code: "RATE_LIMITED"
    });
  });
});
