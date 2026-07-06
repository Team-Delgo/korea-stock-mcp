# MCP 서버 운영 기준

작성일: 2026-07-06

이 문서는 현재 서버가 따르는 MCP 구현 기준을 요약합니다.

## 기준 문서

- MCP Specification 2025-06-18: Streamable HTTP transport
- MCP Specification 2025-06-18: Tools
- MCP Inspector 문서
- MCP Security Best Practices
- MCP TypeScript SDK 1.29.0

## 적용한 기준

- Streamable HTTP 단일 endpoint `/mcp`를 사용합니다.
- stateless mode를 사용해 요청마다 새 MCP server/transport를 생성합니다.
- `Origin` header를 검증해 DNS rebinding 위험을 낮춥니다.
- 로컬 기본 host는 `127.0.0.1`입니다.
- Railway 배포 시에만 `HOST=0.0.0.0`을 start command에서 지정합니다.
- bearer token 인증을 선택적으로 지원합니다.
- 허용 origin에 대해서만 CORS/preflight 응답을 제공합니다.
- tool은 read-only annotation을 포함합니다.
- tool은 공통 envelope `outputSchema`를 포함합니다.
- JSON-RPC/MCP 오류는 HTTP 계층에서 명확한 상태 코드와 JSON body를 반환합니다.
- MCP Inspector로 tool 목록과 호출 결과를 검증할 수 있게 유지합니다.

## 아직 의도적으로 제외한 것

- OAuth authorization server 구현
- stateful session store
- resumable SSE event store
- KIS/DART 외부 API 실제 호출
- 캐시 저장소 구현
- 배포 플랫폼별 secret rotation 자동화

위 항목은 실제 운영 요구가 생겼을 때 별도 작업으로 추가합니다.
