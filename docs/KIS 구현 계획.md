# KIS 구현 계획

작성일: 2026-07-06

이 문서는 KIS 담당 작업자가 `src/clients/kis-rest.ts`, `src/services/kis-auth.ts`,
`src/tools/stock.ts`, `src/tools/market.ts`를 구현하기 위한 단계별 계획입니다.

공통 규칙은 아래 문서를 먼저 숙지합니다.

- `AGENTS.md`
- `docs/CONVENTIONS_KO.md`
- `docs/TESTING_KO.md`

---

## 담당 툴

| 툴 이름 | 설명 |
|---|---|
| `resolve_stock` | 종목명·코드 → KIS stock_code + DART corp_code 매핑 |
| `get_stock_master` | 전체 상장 종목 마스터 목록 조회 |
| `stock_get_quote` | 종목 현재가 시세 조회 |
| `stock_get_orderbook` | 종목 호가·예상 체결 조회 |
| `stock_get_price_history` | 일/주/월/년 OHLCV 이력 조회 |
| `market_get_movers` | 시장 랭킹 (거래량·등락률·시총 등) 조회 |

---

## 구현 파일과 역할

```
src/
├── services/
│   └── kis-auth.ts        # OAuth2 토큰 발급·캐시·갱신
├── clients/
│   └── kis-rest.ts        # KIS REST 요청 공통 래퍼
└── tools/
    ├── stock.ts           # resolve_stock, get_stock_master, stock_get_* 구현
    └── market.ts          # market_get_movers 구현
```

---

## 구현 순서

```
Step 1. kis-auth.ts  →  verify: access_token 정상 발급
Step 2. kis-rest.ts  →  verify: quote 원본 응답 수신 (필드 정규화 전)
Step 3. stock_get_quote  →  verify: ok:true envelope 반환
Step 4. stock_get_price_history, stock_get_orderbook
Step 5. market_get_movers
Step 6. get_stock_master, resolve_stock  (마스터 파일 파싱 — 가장 복잡)
```

각 Step 완료 기준을 만족한 뒤 다음 Step으로 넘어갑니다.

---

## Step 1: `src/services/kis-auth.ts`

### KIS 인증 방식

KIS는 OAuth2 client_credentials 방식입니다.

```
POST {baseUrl}/oauth2/tokenP
Content-Type: application/json
Body:
{
  "grant_type": "client_credentials",
  "appkey": "<KIS_APP_KEY>",
  "appsecret": "<KIS_APP_SECRET>"
}

응답:
{
  "access_token": "...",
  "token_type": "Bearer",
  "expires_in": 86400,   // 24시간
  "access_token_token_expired": "2026-07-07 09:00:00"
}
```

### 구현 요구사항

- 토큰은 메모리에 캐시합니다. 만료 5분 전에 자동 갱신합니다.
- 서버가 stateless(요청마다 새 인스턴스)이므로 모듈 수준 싱글턴으로 캐시합니다.
- `appKey`, `appSecret`, `access_token`은 절대 로그에 출력하지 않습니다.
- `config.kis.env`에 따라 baseUrl을 분기합니다.

```ts
// 인터페이스 예시
export async function getKisAccessToken(cfg: AppConfig): Promise<string>
```

### verify 기준

`getKisAccessToken(config)`를 호출해 non-empty string을 반환하면 완료입니다.

---

## Step 2: `src/clients/kis-rest.ts`

### KIS 요청 공통 헤더

모든 KIS REST 요청에 아래 4개 헤더가 필요합니다.

```
Authorization: Bearer <access_token>
appkey: <KIS_APP_KEY>
appsecret: <KIS_APP_SECRET>
tr_id: <API별 tr_id>
```

추가 선택 헤더:

```
tr_cont: ""          // 연속 조회 여부 (첫 요청은 빈 문자열)
custtype: "P"        // 개인("P") 고정
```

### tr_id 규칙

`config.kis.env === "paper"` (모의투자)이면 tr_id 앞글자를 `V`로 변경합니다.
예: 실전 `FHKST01010100` → 모의 `VHKST01010100`

### 구현 요구사항

```ts
// 인터페이스 예시
export async function kisGet<T>(
  path: string,
  trId: string,
  params: Record<string, string>,
  cfg: AppConfig
): Promise<T>
```

- fetch 또는 Node.js 내장 `fetch`를 사용합니다. 외부 HTTP 라이브러리 추가는 최소화합니다.
- KIS API가 `rt_cd !== "0"` 또는 HTTP 4xx/5xx를 반환하면 에러를 throw합니다.
- 에러 메시지에 `appSecret`·`access_token`이 포함되지 않도록 sanitize합니다.

### verify 기준

`kisGet("/uapi/domestic-stock/v1/quotations/inquire-price", "FHKST01010100", { fid_input_iscd: "005930", ... }, config)`가
원본 KIS 응답 객체를 반환하면 완료입니다.

---

## Step 3–4: `src/tools/stock.ts` 구현

### 함수 시그니처 변경

`registerStockTools`가 `AppConfig`를 인자로 받아야 합니다.
`server-factory.ts`의 호출부도 함께 수정합니다.

```ts
// Before
export function registerStockTools(server: McpServer)

// After
export function registerStockTools(server: McpServer, cfg: AppConfig)
```

### API 엔드포인트 매핑

#### `stock_get_quote`

```
GET /uapi/domestic-stock/v1/quotations/inquire-price
tr_id: FHKST01010100 (실전) / VHKST01010100 (모의)

필수 query params:
  fid_cond_mrkt_div_code: J
  fid_input_iscd: <stock_code>

응답: output (단일 object). 모든 숫자 필드가 string으로 옴 → Number() 변환 필수.

정규화 매핑:
  stck_prpr        → price          (현재가)
  prdy_vrss        → change         (전일대비)
  prdy_vrss_sign   → change_sign    ("1"상한/"2"상승/"3"보합/"4"하락/"5"하한)
  prdy_ctrt        → change_rate    (등락률 %)
  acml_vol         → volume         (누적거래량)
  acml_tr_pbmn     → trading_value  (누적거래대금)
  stck_oprc        → open
  stck_hgpr        → high
  stck_lwpr        → low
  hts_avls         → market_cap     (시가총액, 억원)
  per              → per
  pbr              → pbr
  w52_hgpr         → week52_high
  w52_lwpr         → week52_low
  rprs_mrkt_kor_name → market       (ex. "KOSPI200")
  bstp_kor_isnm    → sector         (업종명)
```

#### `stock_get_orderbook`

```
GET /uapi/domestic-stock/v1/quotations/inquire-asking-price-exp-ccn
tr_id: FHKST01010200 (실전) / VHKST01010200 (모의)

필수 query params:
  fid_cond_mrkt_div_code: J
  fid_input_iscd: <stock_code>

응답 구조: output1 (호가) + output2 (예상체결) — 두 object 모두 사용.

output1 정규화:
  aspr_acpt_hour      → timestamp      (HHMMSS)
  askp1~10            → asks[].price   (매도호가, askp1이 최우선)
  askp_rsqn1~10       → asks[].quantity
  bidp1~10            → bids[].price   (매수호가, bidp1이 최우선)
  bidp_rsqn1~10       → bids[].quantity
  total_askp_rsqn     → total_ask_qty
  total_bidp_rsqn     → total_bid_qty
  price=0인 레벨은 배열에서 제외

output2 정규화:
  antc_cnpr           → expected_price  (예상체결가)
  antc_vol            → expected_volume (예상거래량)
```

#### `stock_get_price_history`

```
GET /uapi/domestic-stock/v1/quotations/inquire-daily-itemchartprice
tr_id: FHKST03010100 (실전) / VHKST03010100 (모의)

필수 query params:
  fid_cond_mrkt_div_code: J
  fid_input_iscd: <stock_code>
  fid_input_date_1: <start YYYYMMDD>
  fid_input_date_2: <end YYYYMMDD>   ← 최대 100건/호출 (API 제한)
  fid_period_div_code: D/W/M/Y
  fid_org_adj_prc: 0(수정주가) / 1(원주가)

응답 구조: output1 (단일 요약, 무시) + output2 (배열, 사용)

output2 배열 정규화:
  stck_bsop_date  → date
  stck_clpr       → close
  stck_oprc       → open
  stck_hgpr       → high
  stck_lwpr       → low
  acml_vol        → volume
  acml_tr_pbmn    → trading_value
  prdy_vrss       → change
  prdy_vrss_sign  → change_sign
  mod_yn          → is_adjusted  ("Y"/"N" → boolean)

output2가 빈 배열이면 NO_DATA envelope 반환.
input limit은 max 100 (API 상한과 동일).
```

### 오류 처리 → ErrorEnvelope 변환

KIS 에러 상황별 `error.code` 매핑:

| 상황 | error.code |
|---|---|
| `rt_cd !== "0"` (KIS 업무 오류) | `UPSTREAM_ERROR` |
| HTTP 429 / 초당 한도 초과 | `RATE_LIMITED` |
| 토큰 만료 (HTTP 401) | `AUTH_EXPIRED` |
| output2 빈 배열 (정상이나 빈 결과) | `NO_DATA` |

파일 내 공통 헬퍼 `kisToolError(err, sourceApi)`로 처리합니다.

---

## Step 5: `src/tools/market.ts` 구현

### `market_get_movers`

`ranking_type`별로 KIS 엔드포인트와 tr_id가 다릅니다.

| ranking_type | 엔드포인트 | tr_id |
|---|---|---|
| `volume` | `/uapi/domestic-stock/v1/ranking/volume` | `FHPST01710000` |
| `change_rate` | `/uapi/domestic-stock/v1/ranking/fluctuation` | `FHPST01740000` |
| `market_cap` | `/uapi/domestic-stock/v1/ranking/market-cap` | `FHPST01750000` |
| `trading_value` | `/uapi/domestic-stock/v1/ranking/trading-value` | `FHPST01760000` |

`dividend_yield`, `short_sale`, `credit_balance`, `new_high_low`는 KIS API 확인 후 추가합니다.
확인 전에는 `NOT_IMPLEMENTED` envelope를 반환합니다.

응답 정규화:

```ts
{
  rank: number,
  stock_code: string,
  name: string,
  price: number,
  change_rate: number,
  volume: number
}
```

---

## Step 6: `get_stock_master` / `resolve_stock`

이 두 툴은 KIS 종목 마스터 데이터에 의존합니다.
KIS는 종목 마스터를 별도 파일(Full Download)로 제공하거나, 개별 API로 조회할 수 있습니다.

### 접근 방법 (우선순위 순)

1. **KIS 종목 마스터 파일 다운로드** — KIS 개발자 포털에서 코스피/코스닥 종목 CSV를 받아 `data/` 디렉터리에 캐시합니다. 서버 시작 시 메모리에 로드합니다.
2. **개별 종목코드 조회 API** — `/uapi/domestic-stock/v1/quotations/search-stock-info` (tr_id: `CTPF1002R`)

`resolve_stock`은 KIS 마스터에서 `stock_code`를 찾고, DART 담당자가 제공하는 `corp_code` 매핑 테이블과 조인합니다.
DART 쪽 구현이 완료되기 전에는 `corp_code` 필드를 `null`로 반환합니다.

```json
{
  "matches": [
    {
      "stock_code": "005930",
      "name": "삼성전자",
      "market": "KOSPI",
      "corp_code": null,
      "isin": "KR7005930003"
    }
  ]
}
```

---

## 응답 envelope 규칙 요약

`src/schemas/common.ts`의 함수를 사용합니다.

```ts
import { jsonToolResponse } from "./helpers.js";
import { successEnvelope, createMeta } from "../schemas/common.js";

// 성공
return jsonToolResponse(
  successEnvelope(data, createMeta("KIS", "inquire-price"))
);

// 실패 (isError: true로 툴 에러 표시)
return jsonToolResponse(
  { ok: false, error: { code: "...", message: "..." }, meta: createMeta("KIS") },
  true
);
```

---

## 테스트 원칙

`docs/TESTING_KO.md` 기준을 따릅니다.

- KIS secret이 필요한 테스트는 기본 CI에 넣지 않습니다.
- KIS REST 클라이언트는 mock HTTP 응답 기반 단위 테스트를 작성합니다.
- 실제 API smoke test는 별도 opt-in 스크립트로 분리합니다.
- 에러 로그에 `appSecret`, `access_token`이 출력되지 않는지 확인합니다.

### mock 테스트 예시 구조

```ts
// tests/kis-rest.test.ts
vi.mock("...", () => ({
  fetch: vi.fn().mockResolvedValue({
    ok: true,
    json: async () => ({
      rt_cd: "0",
      output: { stck_prpr: "75000", ... }
    })
  })
}))
```

---

## 완료 기준

`docs/HANDOFF_KO.md`의 기준을 그대로 따릅니다.

- KIS secret/token이 로그에 노출되지 않습니다.
- `stock_get_quote("005930")`가 `ok: true` envelope를 반환합니다.
- `stock_get_price_history("005930")`가 OHLCV 배열 envelope를 반환합니다.
- `npm.cmd run check`가 통과합니다.
- MCP Inspector에서 모든 KIS 툴이 정상 응답을 반환합니다.
- `account_*`, `order_*` 툴이 툴 목록에 없습니다.
