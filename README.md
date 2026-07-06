# Korea Stocks MCP

Kakao PlayMCP registration skeleton for a read-only Korean stocks MCP server.

The current implementation is mostly a tool skeleton. KIS integrations and most DART tools are not implemented yet, while `dart_get_company_overview` calls the OpenDART company overview API and `dart_get_financial_statement` calls the OpenDART single-company major accounts API.

Korean docs:

- Railway deployment guide: `docs/RAILWAY_DEPLOY_KO.md`
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
- `market_get_movers`
- `dart_search_filings`
- `dart_get_company_overview`
- `dart_get_financial_statement`
- `analysis_get_stock_snapshot`

Registered system tool:

- `system_health`

Trading and account tools are intentionally not included. Do not add `account_*`, `order_*`, order execution, order cancellation, balance, or account-number dependent tools to this read-only server.

## Inspector

After starting the server, use MCP Inspector with Streamable HTTP and connect to:

```text
http://127.0.0.1:3000/mcp
```

You should see the tools listed above. Calling stubbed data tools returns `NOT_IMPLEMENTED`; implemented DART tools require `DART_API_KEY`; `system_health` returns basic server status.

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

For Korean `companyName` input, the DART resolver searches `data/stock_data_ko.json` by stock name and then maps the resulting stock code to a DART `corp_code`. English stock data is kept in `data/stock_data_en.json` for future resolver expansion.

The DART resolver now loads OpenDART `corpCode.xml` data, parses the ZIP-contained XML, and keeps a 24-hour in-memory `stock_code -> corp_code` cache so listed companies can be resolved without hardcoding each mapping. If `DART_API_KEY` is missing, OpenDART is unavailable, or parsing fails, the resolver falls back to the built-in mappings for 삼성전자, SK하이닉스, and LG에너지솔루션. If neither OpenDART data nor fallback contains the stock code, the tool returns a clear unsupported `corp_code` mapping error. The response is wrapped in the common envelope and summarizes revenue, operating income, net income, total assets, total liabilities, and total equity.

DART financial statement accounts are matched with conservative aliases for common OpenDART account-name variants. When consolidated (`CFS`) and separate (`OFS`) rows are both available for the same alias, the consolidated row is preferred.

## Scripts

```powershell
npm.cmd run dev
npm.cmd run check
npm.cmd run test
npm.cmd run build
npm.cmd run typecheck
```
