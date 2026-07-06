# PlayMCP 컨테이너 레지스트리 등록 가이드

작성일: 2026-07-06

이 문서는 Kakao PlayMCP의 컨테이너 이미지 등록 방식에 맞춰 현재 MCP 서버를 등록하는 방법입니다.

## 1. 배포 방식

PlayMCP 등록 폼은 서버 코드를 직접 배포하는 방식이 아니라, 이미 레지스트리에 올라간 컨테이너 이미지를 지정하는 방식입니다.

이 저장소는 GitHub Container Registry, 즉 GHCR에 이미지를 올리도록 설정되어 있습니다.

이미지 이름:

```text
ghcr.io/team-delgo/korea-stock-mcp
```

이미지는 GitHub Actions `Container` workflow로 빌드/푸시됩니다.

- `main` 브랜치 push: `main`, `sha-...` tag 생성
- `v*` git tag push: `0.1.0`, `0.1`, `sha-...`, `latest` tag 생성
- Pull request: build만 수행하고 push하지 않음

## 2. PlayMCP 폼 입력값

기본 정보:

```text
MCP 서버 이름
korea-stock-mcp

설명
KIS Open API와 DART Open API 기반 국내 주식 조회 전용 MCP 서버입니다. 종목 식별, 시세, 공시, 기업개황, 재무제표 조회용 read-only 도구를 제공합니다.
```

레지스트리/이미지:

```text
Registry 호스트
ghcr.io

Registry 사용자
ckrb63

Registry 비밀번호
<read:packages 권한이 있는 GitHub Personal Access Token>

image_name
team-delgo/korea-stock-mcp

image_tag
0.1.1

레지스트리 TLS 검증 해제
체크하지 않음
```

GHCR package를 private으로 유지하는 경우 PlayMCP가 이미지를 pull할 수 있도록 `read:packages` 권한이 있는 GitHub PAT를 Registry 비밀번호에 넣어야 합니다.

## 3. API 키 주입 방식

PlayMCP 등록 화면에 런타임 환경변수/Secret 입력 영역이 없으므로, 현재 PoC 이미지는 KIS/DART 키를 이미지 안의 `/app/.env.production`에 bake합니다.

중요한 보안 주의:

- 이 방식은 운영 권장 방식이 아닙니다.
- private GHCR 이미지 접근 권한이 있는 사람은 이미지에서 키를 추출할 수 있습니다.
- PoC 이후에는 KIS/DART 키를 재발급하고, PlayMCP가 Secret/Env 주입을 지원하는 방식으로 바꾸는 것을 권장합니다.
- 키 값은 저장소 파일에 커밋하지 않고 GitHub Actions Secret에만 저장합니다.

GitHub Actions Secret 이름:

```text
PLAYMCP_RUNTIME_ENV
```

Secret 값 형식:

```text
KIS_APP_KEY=<KIS 앱 키>
KIS_APP_SECRET=<KIS 앱 시크릿>
KIS_ENV=real
DART_API_KEY=<DART API 키>
```

Dockerfile은 이 secret을 build secret으로 받아 최종 이미지에 `.env.production` 파일로 복사합니다. 서버는 컨테이너에서 `DOTENV_CONFIG_PATH=.env.production`을 사용해 값을 읽습니다.

## 4. 이미지 태그 생성

고정 tag를 쓰는 것을 권장합니다.

예시:

```powershell
git checkout main
git pull
git tag v0.1.1
git push origin v0.1.1
```

태그 push 후 GitHub Actions가 성공하면 아래 이미지가 생성됩니다.

```text
ghcr.io/team-delgo/korea-stock-mcp:0.1.1
```

## 5. 컨테이너 기본 런타임 설정

Dockerfile은 컨테이너 환경에 맞춰 아래 기본값을 포함합니다.

```text
NODE_ENV=production
HOST=0.0.0.0
PORT=3000
MCP_ENDPOINT=/mcp
DOTENV_CONFIG_PATH=.env.production
```

## 6. 등록 후 확인

PlayMCP에서 배포된 endpoint가 준비되면 아래를 확인합니다.

```text
/health
/mcp
```

MCP Inspector 또는 PlayMCP tool 목록에서 아래가 보여야 합니다.

- `resolve_stock`
- `stock_get_quote`
- `dart_search_filings`
- `dart_get_company_overview`
- `dart_get_financial_statement`
- `system_health`

`system_health` tool 호출 결과에서 API 키가 들어간 상태라면 아래 값이 `true`가 됩니다.

```json
{
  "kis_configured": true,
  "dart_configured": true
}
```

거래/계좌 tool은 없어야 합니다.
