# Korea Stocks MCP

Kakao PlayMCP registration skeleton for a read-only Korean stocks MCP server.

The current implementation intentionally exposes tool skeletons only. KIS and DART API integrations are not implemented yet, and all data tools return a `NOT_IMPLEMENTED` error envelope.

Korean docs:

- Handoff for KIS/DART implementers: `docs/HANDOFF_KO.md`
- Railway deployment guide: `docs/RAILWAY_DEPLOY_KO.md`


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

You should see the tools listed above. Calling any data tool returns `NOT_IMPLEMENTED`; `system_health` returns basic server status.

## Scripts

```powershell
npm.cmd run dev
npm.cmd run build
npm.cmd run typecheck
```
