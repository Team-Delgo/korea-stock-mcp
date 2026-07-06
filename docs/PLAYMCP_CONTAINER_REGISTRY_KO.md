# PlayMCP 컨테이너 레지스트리 등록 가이드

작성일: 2026-07-06

이 문서는 Kakao PlayMCP의 컨테이너 이미지 등록 방식에 맞춰 현재 MCP 서버를 등록하는 방법입니다.

## 1. 전제

PlayMCP 등록 폼은 서버 코드를 직접 배포하는 방식이 아니라, 이미 레지스트리에 올라간 컨테이너 이미지를 지정하는 방식입니다.

이 저장소는 GitHub Container Registry, 즉 GHCR에 이미지를 올리도록 설정했습니다.

이미지 이름:

```text
ghcr.io/team-delgo/korea-stock-mcp
```

이미지는 GitHub Actions `Container` workflow로 빌드/푸시됩니다.

- `main` 브랜치 push: `main`, `sha-...` tag 생성
- `v*` git tag push: `0.1.0`, `0.1`, `sha-...` tag 생성
- Pull request: build만 수행하고 push하지 않음

## 2. 권장 이미지 태그

PlayMCP 등록에는 고정 tag를 쓰는 것을 권장합니다.

초기 등록 권장:

```text
v0.1.0 git tag 생성
```

그러면 GHCR 이미지 tag는 아래처럼 생성됩니다.

```text
ghcr.io/team-delgo/korea-stock-mcp:0.1.0
```

tag 생성 예시:

```powershell
git checkout main
git pull
git tag v0.1.0
git push origin v0.1.0
```

## 3. PlayMCP 폼 입력값

### 기본 정보

MCP 서버 이름:

```text
korea-stock-mcp
```

설명:

```text
KIS Open API와 DART Open API 기반 국내 주식 조회 전용 MCP 서버입니다. 종목 식별, 시세, 공시, 기업개황, 재무제표 조회용 read-only 도구를 제공합니다.
```

### 레지스트리 · 이미지

Registry 호스트:

```text
ghcr.io
```

Registry 사용자:

```text
ckrb63
```

Registry 비밀번호:

```text
<GitHub Personal Access Token>
```

image_name:

```text
team-delgo/korea-stock-mcp
```

image_tag:

```text
0.1.0
```

레지스트리 TLS 검증 해제:

```text
체크하지 않음
```

## 4. GHCR public/private 선택

이미지를 public으로 공개하면 PlayMCP 폼에서 Registry 사용자/비밀번호를 비워도 될 수 있습니다.

이미지가 private이면 PlayMCP가 이미지를 pull할 수 있도록 GitHub Personal Access Token을 넣어야 합니다.

private image pull용 최소 권한:

```text
read:packages
```

이미지를 직접 push하는 토큰에는 추가로 아래 권한이 필요합니다.

```text
write:packages
```

GitHub Actions는 기본 `GITHUB_TOKEN`으로 GHCR에 push하도록 설정되어 있습니다.

## 5. 컨테이너 런타임 설정

Dockerfile은 컨테이너 환경에 맞춰 아래 기본값을 포함합니다.

```text
HOST=0.0.0.0
PORT=3000
MCP_ENDPOINT=/mcp
NODE_ENV=production
```

PlayMCP 쪽에서 환경변수를 추가로 설정할 수 있다면 아래 값을 넣습니다.

```text
KIS_APP_KEY=<KIS 앱 키>
KIS_APP_SECRET=<KIS 앱 시크릿>
KIS_ENV=paper
DART_API_KEY=<DART API 키>
```

선택:

```text
ALLOWED_ORIGINS=
ALLOWED_HOSTS=
MCP_BEARER_TOKEN=
KIS_BASE_URL_REAL=https://openapi.koreainvestment.com:9443
KIS_BASE_URL_PAPER=https://openapivts.koreainvestment.com:29443
DART_BASE_URL=https://opendart.fss.or.kr/api
CACHE_DB_PATH=./data/kis_dart_cache.sqlite
LOG_LEVEL=info
```

`MCP_BEARER_TOKEN`은 PlayMCP가 Authorization header 설정을 지원할 때만 사용합니다.

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

거래/계좌 tool은 없어야 합니다.

