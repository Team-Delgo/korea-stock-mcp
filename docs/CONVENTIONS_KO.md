# 개발 컨벤션

작성일: 2026-07-06

이 문서는 MCP 서버 구현에서 지켜야 할 코드, API, 보안, 테스트 컨벤션입니다.

## 1. MCP transport 컨벤션

- MCP endpoint는 `/mcp` 하나만 사용합니다.
- Streamable HTTP transport를 사용합니다.
- 서버는 stateless mode를 기본으로 사용합니다.
- `POST /mcp`는 JSON-RPC 요청을 처리합니다.
- `GET /mcp`와 `DELETE /mcp`는 현재 stateless 서버에서 `405 Method Not Allowed`를 반환합니다.
- 지원 MCP protocol version은 `2025-03-26`, `2025-06-18`입니다.
- `MCP-Protocol-Version` header가 없으면 `2025-03-26`으로 간주합니다.

## 2. 보안 컨벤션

- `/health`는 Railway healthcheck를 위해 인증 없이 공개합니다.
- `/mcp`는 optional bearer token을 지원합니다.
- `MCP_BEARER_TOKEN`이 설정되면 `/mcp` 요청은 `Authorization: Bearer <token>`이 필요합니다.
- `Origin` header가 있으면 검증합니다.
- `ALLOWED_ORIGINS`가 비어 있으면 loopback origin만 허용합니다.
- PlayMCP 등 외부 브라우저 기반 host가 Origin을 보낼 경우 `ALLOWED_ORIGINS`에 정확한 origin을 추가합니다.
- `/mcp`의 CORS preflight는 허용된 origin에만 `204`를 반환합니다.
- `ALLOWED_HOSTS`가 설정되면 Host header도 검증합니다.
- secret, token, API key, full request header는 로그에 출력하지 않습니다.

## 3. 환경변수 컨벤션

조회 전용 변수만 사용합니다.

필수 또는 주요 변수:

```text
HOST=127.0.0.1
PORT=3000
MCP_ENDPOINT=/mcp
ALLOWED_ORIGINS=
ALLOWED_HOSTS=
MCP_BEARER_TOKEN=
KIS_APP_KEY=
KIS_APP_SECRET=
KIS_ENV=paper
DART_API_KEY=
```

추가 금지 변수:

```text
KIS_ACCOUNT_NO=
KIS_ACCOUNT_PRODUCT_CODE=
ENABLE_TRADING=
REQUIRE_ORDER_CONFIRMATION=
MAX_ORDER_VALUE_KRW=
ALLOW_MARKET_ORDER=
```

## 4. Tool 컨벤션

- tool 이름은 기존 prefix 규칙을 유지합니다.
- KIS/종목: `stock_*`
- 시장: `market_*`
- DART: `dart_*`
- 조합 분석: `analysis_*`
- 시스템: `system_*`
- `account_*`, `order_*` prefix는 사용하지 않습니다.
- 모든 조회 tool은 read-only annotation을 붙입니다.
- 모든 tool은 공통 envelope `outputSchema`를 노출합니다.

권장 annotation:

```ts
{
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: true
}
```

## 5. 응답 envelope 컨벤션

성공 응답:

```json
{
  "ok": true,
  "data": {},
  "meta": {
    "source": "KIS",
    "source_api": "upstream-api-name",
    "as_of": "2026-07-06T12:00:00+09:00",
    "cached": false,
    "cache_ttl_sec": 3,
    "request_id": "req_..."
  },
  "warnings": []
}
```

오류 응답:

```json
{
  "ok": false,
  "error": {
    "code": "INVALID_INPUT",
    "message": "사용자에게 보여줄 수 있는 메시지"
  },
  "meta": {
    "source": "KIS"
  }
}
```

외부 API 구현 전인 tool은 반드시 `NOT_IMPLEMENTED`를 반환합니다.

MCP tool result는 `structuredContent`와 JSON 문자열 `TextContent`를 함께 반환합니다. 이는 structured result의 역호환성을 위한 규칙입니다.

## 6. 테스트 컨벤션

- 서버 테스트는 `tests/server.test.ts`에 둡니다.
- 외부 API 호출 테스트는 실제 secret에 의존하지 않는 mock 기반으로 작성합니다.
- PlayMCP/Inspector 수동 테스트 전에 `npm.cmd run check`를 통과시킵니다.
- 거래/계좌 tool이 목록에 없는지 테스트로 보호합니다.
- 자세한 테스트 절차는 `docs/TESTING_KO.md`에 유지합니다.

## 7. 문서 컨벤션

- 사용자가 보는 실행/배포 문서는 한국어로 작성합니다.
- 구현자 인수인계는 `docs/HANDOFF_KO.md`에 유지합니다.
- Railway 배포 절차는 `docs/RAILWAY_DEPLOY_KO.md`에 유지합니다.
- 코드 작업 규칙은 `AGENTS.md`와 이 문서에 함께 반영합니다.
