# Railway 배포 가이드

작성일: 2026-07-06

이 문서는 현재 MCP 서버를 Railway에 배포하고, Kakao PlayMCP에 등록할 HTTPS `/mcp` 주소를 얻는 절차입니다.

## 1. 배포 방식

Railway가 코드를 대신 작성하거나 PlayMCP에 자동 등록해주는 것은 아닙니다.

흐름은 아래와 같습니다.

```text
Kakao PlayMCP
  -> https://<railway-domain>/mcp
  -> Railway에서 실행 중인 Node.js MCP 서버
  -> KIS / DART API
```

이 프로젝트에는 Railway용 설정 파일 `railway.json`이 들어 있습니다.

- Build command: `npm ci && npm run build`
- Start command: `HOST=0.0.0.0 npm run start`
- Health check: `/health`

`HOST=0.0.0.0`이 중요합니다. Railway 밖에서 접속하려면 서버가 컨테이너 내부의 모든 네트워크 인터페이스에서 요청을 받아야 합니다.

## 2. GitHub로 배포하는 방법

가장 쉬운 방법입니다.

### 2.1 Git 저장소 만들기

현재 폴더가 아직 git 저장소가 아니라면 PowerShell에서 실행합니다.

```powershell
cd "C:\Users\cksr1\Desktop\KOREA STOCKS"
git init
git add .
git commit -m "Initial MCP server skeleton"
```

그 다음 GitHub에서 새 repository를 만들고, GitHub가 안내하는 remote 명령을 실행합니다.

예시:

```powershell
git remote add origin https://github.com/<your-id>/<your-repo>.git
git branch -M main
git push -u origin main
```

### 2.2 Railway에서 GitHub repo 연결

1. Railway에 로그인합니다.
2. `New Project`를 누릅니다.
3. `Deploy from GitHub repo`를 선택합니다.
4. 방금 올린 repository를 선택합니다.
5. Railway가 자동으로 Node.js 프로젝트를 감지합니다.
6. 배포가 시작되면 `railway.json`의 build/start/health 설정이 적용됩니다.

## 3. 환경변수 설정

Railway 프로젝트의 서비스 화면에서 `Variables`에 아래 값을 설정합니다.

필수:

```text
MCP_ENDPOINT=/mcp
KIS_APP_KEY=<KIS 앱 키>
KIS_APP_SECRET=<KIS 앱 시크릿>
KIS_ENV=paper
DART_API_KEY=<DART API 키>
```

선택 또는 기본값 사용 가능:

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

Railway는 `PORT`를 자동으로 주입합니다. 직접 `PORT`를 고정하지 않는 것을 권장합니다.

`HOST`는 `railway.json`의 start command에서 `0.0.0.0`으로 지정하므로 Variables에 따로 넣지 않아도 됩니다.

보안 참고:

- `MCP_BEARER_TOKEN`을 설정하면 PlayMCP 또는 Inspector 요청에 `Authorization: Bearer <token>`이 필요합니다.
- PlayMCP가 `Origin` header 또는 browser preflight 요청을 보내며 연결에 실패하면 Railway 로그의 origin 값을 확인해 `ALLOWED_ORIGINS`에 정확히 추가합니다.
- 처음 연결 테스트에서는 `ALLOWED_ORIGINS`를 비워두고 health/MCP 연결을 먼저 확인한 뒤, 필요한 경우 제한을 추가합니다.

## 4. Railway public domain 만들기

배포가 성공하면:

1. Railway 서비스 화면으로 이동합니다.
2. `Settings` 또는 `Networking` 메뉴를 엽니다.
3. `Generate Domain` 또는 public domain 생성 버튼을 누릅니다.
4. 생성된 domain을 확인합니다.

예시:

```text
https://korea-stocks-mcp-production.up.railway.app
```

MCP endpoint는 여기에 `/mcp`를 붙인 주소입니다.

```text
https://korea-stocks-mcp-production.up.railway.app/mcp
```

Kakao PlayMCP에는 이 `/mcp` 주소를 등록합니다.

## 5. 배포 확인

브라우저 또는 PowerShell에서 health check를 확인합니다.

```powershell
Invoke-RestMethod https://<railway-domain>/health
```

정상 응답 예시:

```json
{
  "ok": true,
  "status": "ok",
  "server": "korea-stocks-mcp",
  "version": "0.1.0",
  "mcp_endpoint": "/mcp",
  "read_only": true
}
```

MCP Inspector에서 확인할 때는 Streamable HTTP transport를 선택하고 아래 주소를 넣습니다.

```text
https://<railway-domain>/mcp
```

현재 단계에서 정상 기준:

- `system_health`는 성공 응답
- KIS/DART 데이터 tool은 아직 `NOT_IMPLEMENTED`
- `account_*`, `order_*` tool은 보이지 않아야 함

## 6. Railway CLI로 배포하는 방법

GitHub 연결 방식이 더 쉽지만, CLI로도 가능합니다.

Windows PowerShell에서는 npm 방식이 가장 단순합니다.

```powershell
npm.cmd install -g @railway/cli
railway login
railway init
railway up
```

기존 Railway 프로젝트에 연결하려면:

```powershell
railway link
railway up
```

단, `railway login`, `railway init`, `railway link`는 계정과 프로젝트 선택이 필요하므로 사용자가 직접 브라우저/터미널에서 진행해야 합니다.

## 7. 자주 나는 문제

### Health check 실패

대부분 아래 중 하나입니다.

- `npm run build` 실패
- `dist/server.js`가 생성되지 않음
- `HOST=0.0.0.0`이 적용되지 않음
- 앱이 Railway가 주입한 `PORT`를 사용하지 않음

현재 코드는 `process.env.PORT`를 읽고, `railway.json`에서 `HOST=0.0.0.0`을 지정합니다.

### PlayMCP에서 연결 실패

확인 순서:

1. `https://<railway-domain>/health`가 열리는지 확인
2. PlayMCP 등록 주소가 `/mcp`로 끝나는지 확인
3. Railway 로그에 MCP request 오류가 있는지 확인
4. `ALLOWED_ORIGINS`를 비워둔 상태로 먼저 테스트
5. `MCP_BEARER_TOKEN`을 설정했다면 PlayMCP 쪽에 같은 bearer token을 전달하는 설정이 있는지 확인

### KIS/DART tool이 동작하지 않음

현재는 정상입니다. 아직 골격 단계라 데이터 tool은 `NOT_IMPLEMENTED`를 반환합니다.
