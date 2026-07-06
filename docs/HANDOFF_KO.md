# KIS + DART 국내 주식 MCP 구현 인수인계 문서

작성일: 2026-07-06

이 문서는 두 명의 작업자가 KIS와 DART 구현을 나누어 이어갈 수 있도록 정리한 안내서입니다.

## 현재 상태

- TypeScript 기반 MCP 서버입니다.
- Streamable HTTP endpoint는 `/mcp`입니다.
- health endpoint는 `/health`입니다.
- 데이터 tool은 아직 외부 API를 호출하지 않고 `NOT_IMPLEMENTED`를 반환합니다.
- `system_health`만 실제 상태 정보를 반환합니다.

공통 개발 규칙은 먼저 아래 문서를 확인합니다.

- `AGENTS.md`
- `docs/CONVENTIONS_KO.md`
- `docs/MCP_BEST_PRACTICES_KO.md`

## 작업자 1: KIS 담당

담당 tool:

- `resolve_stock`
- `get_stock_master`
- `stock_get_quote`
- `stock_get_orderbook`
- `stock_get_price_history`
- `market_get_movers`

주요 예정 파일:

- `src/clients/kis-rest.ts`
- `src/services/kis-auth.ts`
- `src/tools/stock.ts`
- `src/tools/market.ts`

완료 기준:

- KIS secret/token이 로그에 노출되지 않습니다.
- `stock_get_quote("005930")`가 실제 현재가 envelope를 반환합니다.
- `stock_get_price_history("005930")`가 OHLCV 배열을 반환합니다.
- `npm.cmd run check`가 통과합니다.

## 작업자 2: DART 담당

담당 tool:

- `dart_search_filings`
- `dart_get_company_overview`
- `dart_get_financial_statement`

주요 예정 파일:

- `src/clients/dart.ts`
- `src/services/dart-corp-code.ts`
- `src/tools/dart.ts`

완료 기준:

- DART API key가 로그에 노출되지 않습니다.
- `dart_get_company_overview("00126380")`가 기업개황 envelope를 반환합니다.
- `dart_search_filings`가 최근 공시 목록을 반환합니다.
- `npm.cmd run check`가 통과합니다.

## 공동 합의 지점

`resolve_stock`은 KIS와 DART가 만나는 지점입니다. 출력 구조는 아래 형태를 유지합니다.

```json
{
  "matches": [
    {
      "stock_code": "005930",
      "name": "삼성전자",
      "market": "KOSPI",
      "corp_code": "00126380",
      "corp_name": "삼성전자",
      "isin": "KR7005930003"
    }
  ]
}
```

`analysis_get_stock_snapshot`은 KIS/DART MVP가 동작한 뒤 마지막에 구현합니다.

## 병합 전 확인

```powershell
npm.cmd run check
```

추가 확인:

- `account_*`, `order_*` tool이 없어야 합니다.
- 모든 tool 응답은 공통 envelope를 유지해야 합니다.
- secret/token/API key가 로그나 문서에 들어가지 않아야 합니다.

