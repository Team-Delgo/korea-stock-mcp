# 테스트 가이드

작성일: 2026-07-06

## 기본 검증

모든 작업 후 아래 명령을 실행합니다.

```powershell
npm.cmd run check
```

이 명령은 아래 세 단계를 순서대로 실행합니다.

```powershell
npm.cmd run typecheck
npm.cmd run test
npm.cmd run build
```

## 현재 자동 테스트 범위

`tests/server.test.ts`는 외부 API 호출 없이 MCP 서버 골격을 검증합니다.

- `/health` 공개 응답
- Express fingerprint header 제거
- MCP `tools/list` 목록
- `account_*`, `order_*` tool 부재
- read-only tool annotation
- 미구현 데이터 tool의 `NOT_IMPLEMENTED` envelope
- Origin 검증
- optional bearer token 검증
- MCP protocol version 검증
- Streamable HTTP `Accept` header 검증
- stateless endpoint의 `GET`, `DELETE` 405 응답

## 수동 Inspector 테스트

서버 실행:

```powershell
npm.cmd run dev
```

Inspector 실행:

```powershell
npx @modelcontextprotocol/inspector
```

Inspector 설정:

```text
Transport: Streamable HTTP
URL: http://127.0.0.1:3000/mcp
```

정상 기준:

- `system_health`는 성공 응답
- 데이터 tool은 `NOT_IMPLEMENTED` 반환
- `account_*`, `order_*` tool은 목록에 없음

## 외부 API 구현 후 테스트 원칙

- KIS/DART 실제 secret이 필요한 테스트는 기본 CI에 넣지 않습니다.
- 외부 API client는 mock HTTP 응답 기반 단위 테스트를 먼저 작성합니다.
- 실제 API smoke test가 필요하면 별도 opt-in script로 분리합니다.
- secret/token/API key는 테스트 실패 로그에 출력하지 않습니다.

