# Korea Stocks MCP

Kakao PlayMCP registration skeleton for a read-only Korean stocks MCP server.

The current implementation is mostly a tool skeleton. KIS integrations and most DART tools are not implemented yet, while `dart_search_filings` calls the OpenDART disclosure search API, `dart_get_company_overview` calls the OpenDART company overview API, and `dart_get_financial_statement` calls the OpenDART single-company major accounts API.

Korean docs:

- Railway deployment guide: `docs/RAILWAY_DEPLOY_KO.md`
- PlayMCP container registry guide: `docs/PLAYMCP_CONTAINER_REGISTRY_KO.md`
- Handoff for KIS/DART implementers: `docs/HANDOFF_KO.md`
- Development conventions: `docs/CONVENTIONS_KO.md`
- MCP server operating baseline: `docs/MCP_BEST_PRACTICES_KO.md`
- Testing guide: `docs/TESTING_KO.md`


## Requirements

- Node.js 22+
- npm

On Windows PowerShell, use `npm.cmd` if script execution blocks `npm.ps1`.

## Setup

```powershell
npm.cmd install
Copy-Item .env.example .env
npm.cmd run dev
```

The local server defaults to:

- Health check: `http://127.0.0.1:3000/health`
- MCP endpoint: `http://127.0.0.1:3000/mcp`

For PlayMCP, deploy behind HTTPS and register:

```text
https://<your-domain>/mcp
```

## Tool Scope

Registered data tools:

- `resolve_stock`
- `get_stock_master`
- `stock_get_quote`
- `stock_get_orderbook`
- `stock_get_price_history`
- `market_get_index`
- `market_get_sector`
- `market_get_news`
- `market_get_movers`
- `dart_get_company_overview`
- `dart_get_financial_statement`

Registered system tool:

- `system_health`

Trading and account tools are intentionally not included. Do not add `account_*`, `order_*`, order execution, order cancellation, balance, or account-number dependent tools to this read-only server.

## Inspector

After starting the server, use MCP Inspector with Streamable HTTP and connect to:

```text
http://127.0.0.1:3000/mcp
```

You should see the tools listed above. KIS tools require KIS credentials, DART tools require `DART_API_KEY`, and `system_health` returns basic server status.

## DART Filings Search Example

Set `DART_API_KEY` in `.env`, start the server, and call `dart_search_filings` through an MCP client.

Example arguments:

```json
{
  "companyName": "삼성전자",
  "start_date": "20240101",
  "end_date": "20241231",
  "disclosure_type": "ALL",
  "final_only": true,
  "page": 1,
  "page_size": 20
}
```

You can also use a supported stock code or a DART corporation code:

```json
{
  "stockCode": "005930"
}
```

```json
{
  "corp_code": "00126380"
}
```

The tool resolves `companyName`, `stockCode`, or `stock_code` to an OpenDART `corp_code`, calls `list.json`, and returns normalized filing rows with DART filing URLs in the common envelope. If `disclosure_type` is `ALL`, the OpenDART `pblntf_ty` parameter is omitted.

## DART Company Overview Example

Set `DART_API_KEY` in `.env`, start the server, and call `dart_get_company_overview` through an MCP client.

Example arguments:

```json
{
  "companyName": "삼성전자"
}
```

You can also use a supported stock code:

```json
{
  "stockCode": "005930"
}
```

The tool resolves `companyName` or `stockCode` to an OpenDART `corp_code`, calls `company.json`, and returns normalized company overview fields in the common envelope.

## DART Financial Statement Example

Set `DART_API_KEY` in `.env`, start the server, and call `dart_get_financial_statement` through an MCP client.

Example arguments:

```json
{
  "companyName": "삼성전자",
  "year": "2023",
  "reportCode": "11011"
}
```

You can also use a supported stock code:

```json
{
  "stockCode": "005930",
  "year": "2023"
}
```

한국어 `companyName` 입력은 `data/stock_data_ko.json`에서 종목명을 검색한 뒤, 해당 종목코드를 DART `corp_code`로 매핑합니다. 한국어 종목명은 공백을 제거해 비교하므로 `삼성 전자` 같은 입력도 `삼성전자`로 조회할 수 있습니다. 영문 `companyName` 입력은 trim 후 대문자로 normalize하여 `data/stock_data_en.json`에서 검색하므로 `NAVER`, `Naver`, `naver`처럼 대소문자가 달라도 동일한 영문 종목명으로 조회됩니다.

The DART resolver now loads OpenDART `corpCode.xml` data, parses the ZIP-contained XML, and keeps a 24-hour in-memory `stock_code -> corp_code` cache so listed companies can be resolved without hardcoding each mapping. If `DART_API_KEY` is missing, OpenDART is unavailable, or parsing fails, the resolver falls back to the built-in mappings for 삼성전자, SK하이닉스, and LG에너지솔루션. If neither OpenDART data nor fallback contains the stock code, the tool returns a clear unsupported `corp_code` mapping error. The response is wrapped in the common envelope and summarizes revenue, operating income, net income, total assets, total liabilities, and total equity.

DART financial statement accounts are matched with conservative aliases for common OpenDART account-name variants. When consolidated (`CFS`) and separate (`OFS`) rows are both available for the same alias, the consolidated row is preferred.

## MVP 로컬 검증 결과

PR #1부터 PR #5까지 merge한 뒤, 로컬 환경에서 실제 OpenDART API를 호출해 DART MVP 흐름을 검증했습니다.

검증 환경:

- MCP endpoint: `http://127.0.0.1:3000/mcp`
- 로컬 `.env`에 `DART_API_KEY` 설정
- mock이 아닌 실제 OpenDART API 호출로 검증

검증 완료 케이스:

| Tool | 입력값 | 결과 | 비고 |
| --- | --- | --- | --- |
| `dart_get_company_overview` | `현대차` | 성공 | KOSPI, `stock_code` 005380, `corp_code` 00164742 |
| `dart_get_financial_statement` | `현대차` | 성공 | 2023년 사업보고서 기준, 주요 6개 계정 반환: `revenue`, `operating_income`, `net_income`, `total_assets`, `total_liabilities`, `total_equity` |
| `dart_get_company_overview` | `카카오` | 성공 | KOSPI, `stock_code` 035720, `corp_code` 00258801 |
| `dart_get_company_overview` | `NAVER` | 성공 | KOSPI, `stock_code` 035420, `corp_code` 00266961 |
| `dart_get_financial_statement` | `NAVER` | 성공 | 2023년 사업보고서 기준, 주요 6개 계정 반환 |
| `dart_get_company_overview` | `알테오젠` | 성공 | KOSDAQ GLOBAL, `stock_code` 196170, `corp_code` 00989619 |
| `dart_get_company_overview` | `없는회사` | 정상 실패 | `INVALID_INPUT` |

`현대차`와 `알테오젠`은 기존 하드코딩 fallback 종목이 아닙니다. 두 종목의 조회 성공을 통해 `stock_data_ko.json` 기반 종목명 검색과 OpenDART `corpCode.xml` 기반 `stockCode` → `corpCode` 매핑이 하드코딩되지 않은 상장사에도 실제로 동작함을 확인했습니다.

또한 `현대차` 재무제표 테스트에서 `net_income`이 정상 반환되었습니다. 이를 통해 DART 계정명 alias matching 개선이 실제 로컬 API 테스트에서도 동작함을 확인했습니다.

제한사항: 현재 영문 종목명 매칭은 보수적으로 동작합니다. `NAVER`는 조회되지만, `naver` 또는 `Naver`처럼 소문자/혼합 대소문자 입력은 아직 조회되지 않을 수 있습니다. 영문 종목명 대소문자 normalize는 후속 PR에서 개선할 예정입니다.

## Scripts

```powershell
npm.cmd run dev
npm.cmd run check
npm.cmd run test
npm.cmd run build
npm.cmd run typecheck
```
