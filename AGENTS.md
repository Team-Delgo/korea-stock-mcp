# AGENTS.md

이 저장소에서 작업하는 Codex, 에이전트, 개발자는 아래 규칙을 따릅니다.

## 프로젝트 목적

- Kakao PlayMCP에 등록할 read-only 국내 주식 MCP 서버입니다.
- KIS Open API와 DART Open API 조회 기능을 제공하는 것이 목표입니다.
- 현재 외부 API 호출 구현은 의도적으로 제외하고, MCP 서버 골격, 보안, 테스트, 문서 기반을 먼저 완성합니다.

## 절대 금지 범위

- `account_*` tool 추가 금지
- `order_*` tool 추가 금지
- 계좌번호, 계좌상품코드, 잔고, 주문 가능 금액, 주문, 정정, 취소, 체결/미체결 조회 기능 추가 금지
- 매수/매도 추천 또는 투자 조언 생성 금지
- API key, app secret, access token 로그 출력 금지

## 구현 원칙

- MCP transport는 Streamable HTTP `/mcp` endpoint를 유지합니다.
- 서버는 stateless mode를 기본으로 유지합니다.
- tool 응답은 `src/schemas/common.ts`의 envelope 형식을 사용합니다.
- 외부 API 원본 응답을 그대로 노출하지 말고, 정규화된 필드명으로 반환합니다.
- 모든 조회 tool은 `readOnlyHint: true`, `destructiveHint: false` annotation을 유지합니다.
- 외부 API 호출 구현 전까지 해당 tool은 `NOT_IMPLEMENTED` 오류 envelope를 반환해야 합니다.

## 파일 경계

- MCP HTTP 서버/transport: `src/server.ts`, `src/server-factory.ts`, `src/http/*`
- 공통 타입/상수: `src/schemas/common.ts`, `src/constants.ts`
- tool 등록: `src/tools/*`
- KIS 구현 예정 영역: `src/clients/kis-rest.ts`, `src/services/kis-auth.ts`, `src/tools/stock.ts`, `src/tools/market.ts`
- DART 구현 예정 영역: `src/clients/dart.ts`, `src/services/dart-corp-code.ts`, `src/tools/dart.ts`

공통 파일을 바꾸는 경우 KIS/DART 양쪽 작업자에게 영향을 주는지 먼저 확인합니다.

## 필수 검증

작업 후 최소 아래 명령을 실행합니다.

```powershell
npm.cmd run check
```

개별 확인이 필요하면:

```powershell
npm.cmd run typecheck
npm.cmd run test
npm.cmd run build
```

컨테이너 배포 관련 파일을 바꾼 경우 Docker가 설치된 환경에서 아래도 확인합니다.

```powershell
docker build -t korea-stock-mcp:local .
```

## Git 규칙

- 의미 있는 작업 단위마다 커밋합니다.
- 커밋 메시지는 짧은 영어 명령형을 사용합니다.
- 예: `Harden MCP HTTP transport`, `Document implementation conventions`
- 사용자가 명시적으로 요청하기 전에는 외부 API secret을 커밋하지 않습니다.
