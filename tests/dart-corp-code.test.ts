import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { zipSync } from "fflate";
import { afterEach, describe, expect, it } from "vitest";
import {
  getDartCorpCodeByStockCode,
  parseDartCorpCodeXml,
  parseDartCorpCodeZip,
  resetDartCorpCodeCacheForTest,
  setDartCorpCodeCacheForTest
} from "../src/services/dart-corp-code.js";

const fixtureXml = readFileSync(
  resolve(process.cwd(), "tests/fixtures/dart-corp-code.xml"),
  "utf8"
);

describe("DART corpCode service", () => {
  afterEach(() => {
    resetDartCorpCodeCacheForTest();
  });

  it("parses listed companies and excludes entries with an empty stock_code", () => {
    const entries = parseDartCorpCodeXml(fixtureXml);

    expect(entries).toEqual([
      {
        corpCode: "00164742",
        corpName: "현대자동차",
        corpEngName: "HYUNDAI MOTOR COMPANY",
        stockCode: "005380",
        modifyDate: "20240101"
      }
    ]);
  });

  it("parses CORPCODE.xml from a ZIP archive", () => {
    const zipBytes = zipSync({
      "CORPCODE.xml": new TextEncoder().encode(fixtureXml)
    });

    expect(parseDartCorpCodeZip(zipBytes)).toHaveLength(1);
  });

  it("finds corpCode by stockCode from a downloaded fixture ZIP", async () => {
    const zipBytes = zipSync({
      "CORPCODE.xml": new TextEncoder().encode(fixtureXml)
    });
    const fetcher = async () => new Response(zipBytes);

    const result = await getDartCorpCodeByStockCode("005380", {
      apiKey: "test-key",
      baseUrl: "https://example.test/api",
      fetcher
    });

    expect(result).toMatchObject({
      ok: true,
      entry: {
        corpCode: "00164742",
        corpName: "현대자동차",
        stockCode: "005380"
      }
    });
  });

  it("does not download when DART_API_KEY is missing", async () => {
    let fetchCount = 0;
    const fetcher = async () => {
      fetchCount += 1;
      return new Response();
    };

    const result = await getDartCorpCodeByStockCode("005380", {
      apiKey: "",
      fetcher
    });

    expect(result).toMatchObject({
      ok: false,
      code: "MISSING_API_KEY"
    });
    expect(fetchCount).toBe(0);
  });

  it("returns a failure result for malformed ZIP data without throwing", async () => {
    const result = await getDartCorpCodeByStockCode("005380", {
      apiKey: "test-key",
      baseUrl: "https://example.test/api",
      fetcher: async () => new Response(new TextEncoder().encode("not a zip"))
    });

    expect(result).toMatchObject({
      ok: false,
      code: "PARSE_FAILED"
    });
  });

  it("uses stale cache when a refresh fails", async () => {
    setDartCorpCodeCacheForTest([
      {
        corpCode: "00164742",
        corpName: "현대자동차",
        corpEngName: "HYUNDAI MOTOR COMPANY",
        stockCode: "005380",
        modifyDate: "20240101"
      }
    ]);

    const result = await getDartCorpCodeByStockCode("005380", {
      apiKey: "test-key",
      now: () => Date.now() + 25 * 60 * 60 * 1000,
      fetcher: async () => {
        throw new Error("network down");
      }
    });

    expect(result).toMatchObject({
      ok: true,
      entry: {
        corpCode: "00164742"
      }
    });
  });
});
