# 신규 Market Tool 구현 계획

> 작성일: 2026-07-06  
> 브랜치: `kis/feat-auth` (또는 신규 브랜치 분기 권장)

---

## 구현 대상 (3개 tool, 4개 KIS API)

| # | Tool name | KIS TR ID | KIS 엔드포인트 | 파일 |
|---|-----------|-----------|---------------|------|
| 1 | `market_get_index` (mode=quote) | `FHPUP02100000` | `inquire-index-price` | `src/tools/market.ts` |
| 1 | `market_get_index` (mode=history) | `FHPUP02120000` | `inquire-index-daily-price` | `src/tools/market.ts` |
| 2 | `market_get_sector` | `FHKUP03500100` | `inquire-daily-indexchartprice` | `src/tools/market.ts` |
| 3 | `market_get_news` | `FHKST01011800` | `news-title` | `src/tools/market.ts` |

> **제외:** `stock_get_investor_trend` (FHKST01010900), `stock_get_intraday` (FHKST03010200) — Excel 문서 없음

---

## 1. `market_get_index`

두 가지 mode를 하나의 tool로 처리. mode에 따라 호출하는 TR ID가 달라짐.

### Input Schema
```ts
{
  index: z.enum(["KOSPI", "KOSDAQ", "KOSPI200"]).default("KOSPI"),
  mode: z.enum(["quote", "history"]).default("quote"),
  // mode=history 전용
  period: z.enum(["D", "W", "M"]).default("D"),
  date: z.string().optional(),  // YYYYMMDD, 기본값 오늘 (output2 기준일, history 100건)
  limit: z.number().int().positive().max(100).default(30),
}
```

### 업종코드 매핑
```ts
const INDEX_ISCD = { KOSPI: "0001", KOSDAQ: "1001", KOSPI200: "2001" };
```

---

### mode=quote → FHPUP02100000

**KIS Request**
```
GET /uapi/domestic-stock/v1/quotations/inquire-index-price
FID_COND_MRKT_DIV_CODE = "U"
FID_INPUT_ISCD         = "0001" | "1001" | "2001"
```

**KIS Response** (`output` single object)
| 필드 | 한글명 | 사용 여부 |
|------|--------|----------|
| `bstp_nmix_prpr` | 업종 지수 현재가 | ✅ |
| `bstp_nmix_prdy_vrss` | 전일 대비 | ✅ |
| `prdy_vrss_sign` | 전일 대비 부호 | ✅ |
| `bstp_nmix_prdy_ctrt` | 전일 대비율 | ✅ |
| `bstp_nmix_oprc` | 시가 | ✅ |
| `bstp_nmix_hgpr` | 최고가 | ✅ |
| `bstp_nmix_lwpr` | 최저가 | ✅ |
| `acml_vol` | 누적 거래량 | ✅ |
| `acml_tr_pbmn` | 누적 거래 대금 | ✅ |
| `ascn_issu_cnt` | 상승 종목 수 | ✅ |
| `stnr_issu_cnt` | 보합 종목 수 | ✅ |
| `down_issu_cnt` | 하락 종목 수 | ✅ |
| `uplm_issu_cnt` | 상한 종목 수 | ✅ |
| `lslm_issu_cnt` | 하한 종목 수 | ✅ |
| `total_askp_rsqn` | 총 매도호가 잔량 | ✅ |
| `total_bidp_rsqn` | 총 매수호가 잔량 | ✅ |
| `ntby_rsqn` | 순매수 잔량 | ✅ |
| `dryy_bstp_nmix_hgpr` / `*_date` | 연중 최고가 / 일자 | ✅ |
| `dryy_bstp_nmix_lwpr` / `*_date` | 연중 최저가 / 일자 | ✅ |

**Output (data)**
```jsonc
{
  "index": "KOSPI",
  "mode": "quote",
  "price": 2850.34,
  "change": 12.45,
  "change_sign": "2",
  "change_rate": 0.44,
  "open": 2838.0, "high": 2855.12, "low": 2835.60,
  "volume": 593842,
  "trading_value": 10221804,
  "advances": 628, "declines": 250, "unchanged": 58, "limit_up": 0, "limit_down": 0,
  "total_ask_qty": 24146999, "total_bid_qty": 40450437, "net_bid_qty": 16303438,
  "year_high": 2675.80, "year_high_date": "20240109",
  "year_low": 2429.12, "year_low_date": "20240118"
}
```

**캐시:** TTL 60s, key `FHPUP02100000:{iscd}`

---

### mode=history → FHPUP02120000

**KIS Request**
```
GET /uapi/domestic-stock/v1/quotations/inquire-index-daily-price
FID_COND_MRKT_DIV_CODE = "U"
FID_INPUT_ISCD         = "0001" | "1001" | "2001"
FID_PERIOD_DIV_CODE    = "D" | "W" | "M"
FID_INPUT_DATE_1       = "YYYYMMDD"  (기준일, 이 날짜 포함 최근 100건)
```

**KIS Response**
- `output1`: 당일 지수 요약 (quote와 동일 필드 서브셋)
- `output2` (array): 기간별 OHLCV
  - `stck_bsop_date`, `bstp_nmix_prpr` (종가), `bstp_nmix_oprc`, `bstp_nmix_hgpr`, `bstp_nmix_lwpr`, `acml_vol`, `acml_tr_pbmn`, `bstp_nmix_prdy_vrss`, `prdy_vrss_sign`, `bstp_nmix_prdy_ctrt`

**Output (data)**
```jsonc
{
  "index": "KOSPI",
  "mode": "history",
  "period": "D",
  "summary": { /* output1 핵심 필드 */ },
  "rows": [
    { "date": "20260706", "close": 2850.34, "open": 2838.0, "high": 2855.12, "low": 2835.60,
      "volume": 593842, "trading_value": 10221804, "change": 12.45, "change_sign": "2", "change_rate": 0.44 }
  ]
}
```

**캐시:** TTL 60s, key `FHPUP02120000:{iscd}:{period}:{date}`

---

## 2. `market_get_sector`

특정 업종코드의 현재 지수 + 기간별 OHLCV 히스토리.  
FHKUP03500100의 `output1`(현재 스냅샷) + `output2`(기간별 시세) 모두 반환.

> FHKUP03500100은 FHPUP02120000과 달리 **시작/종료일자를 직접 지정**할 수 있으며 **년봉(Y)**도 지원.

### Input Schema
```ts
{
  sector_code: z.string().min(1)
    .describe("업종코드 (예: 0001=종합, 0002=대형주, 1001=코스닥, 업종코드 목록은 KIS 포탈 참조)"),
  period: z.enum(["D", "W", "M", "Y"]).default("D"),
  start_date: z.string().optional(),  // YYYYMMDD
  end_date: z.string().optional(),    // YYYYMMDD, 기본 오늘
  limit: z.number().int().positive().max(50).default(30),
}
```

### KIS Request
```
GET /uapi/domestic-stock/v1/quotations/inquire-daily-indexchartprice
FID_COND_MRKT_DIV_CODE = "U"
FID_INPUT_ISCD         = sector_code
FID_INPUT_DATE_1       = start_date (YYYYMMDD)
FID_INPUT_DATE_2       = end_date   (YYYYMMDD)
FID_PERIOD_DIV_CODE    = "D" | "W" | "M" | "Y"
```

### KIS Response
**output1** (single): 업종 현재 스냅샷
| 필드 | 한글명 |
|------|--------|
| `hts_kor_isnm` | 업종명 |
| `bstp_nmix_prpr` | 현재 지수 |
| `bstp_nmix_prdy_ctrt` | 전일 대비율 |
| `prdy_vrss_sign` | 전일 대비 부호 |
| `bstp_nmix_oprc` / `hgpr` / `lwpr` | 시가/최고/최저 |
| `acml_vol` / `acml_tr_pbmn` | 거래량/거래대금 |
| `bstp_cls_code` | 업종 구분 코드 |

**output2** (array): 기간별 OHLCV
| 필드 | 한글명 |
|------|--------|
| `stck_bsop_date` | 영업 일자 |
| `bstp_nmix_prpr` | 지수 (종가) |
| `bstp_nmix_oprc` / `hgpr` / `lwpr` | 시가/최고/최저 |
| `acml_vol` / `acml_tr_pbmn` | 거래량/거래대금 |
| `mod_yn` | 수정 여부 |

### Output (data)
```jsonc
{
  "sector_code": "0001",
  "sector_name": "종합",
  "period": "D",
  "snapshot": {
    "price": 2850.34, "change_rate": 0.44, "change_sign": "2",
    "open": 2838.0, "high": 2855.12, "low": 2835.60,
    "volume": 593842, "trading_value": 10221804
  },
  "rows": [
    { "date": "20260706", "close": 2850.34, "open": 2838.0, "high": 2855.12, "low": 2835.60,
      "volume": 593842, "trading_value": 10221804, "is_adjusted": false }
  ]
}
```

**캐시:** TTL 60s, key `FHKUP03500100:{sector_code}:{period}:{start}:{end}`

---

## 3. `market_get_news`

시장 뉴스 및 공시 제목 목록 조회.

### Input Schema
```ts
{
  stock_code: z.string().optional()
    .describe("종목코드 (공백 시 전체 시장 뉴스)"),
  date: z.string().optional()
    .describe("조회 기준 날짜 YYYYMMDD (기본: 현재)"),
  time: z.string().optional()
    .describe("조회 기준 시간 HHMMSS (기본: 현재)"),
  limit: z.number().int().positive().max(200).default(20),
}
```

### KIS Request
```
GET /uapi/domestic-stock/v1/quotations/news-title
FID_NEWS_OFER_ENTP_CODE = ""   (공백 필수)
FID_COND_MRKT_CLS_CODE  = ""   (공백 필수)
FID_INPUT_ISCD          = stock_code | ""
FID_TITL_CNTT           = ""   (공백 필수)
FID_INPUT_DATE_1        = "00YYYYMMDD" | ""  (공백=현재기준)
FID_INPUT_HOUR_1        = "0000HHMMSS" | ""  (공백=현재기준)
FID_RANK_SORT_CLS_CODE  = ""   (공백 필수)
FID_INPUT_SRNO          = ""   (공백 필수)
```

### KIS Response (`output` array, max 200)
| 필드 | 한글명 |
|------|--------|
| `cntt_usiq_srno` | 내용 조회용 일련번호 |
| `news_ofer_entp_code` | 뉴스 제공 업체 코드 |
| `data_dt` | 작성 일자 (YYYYMMDD) |
| `data_tm` | 작성 시간 (HHMMSS) |
| `hts_pbnt_titl_cntt` | 제목 |
| `news_lrdv_code` | 뉴스 대구분 코드 |

**뉴스 업체 코드 주요 값:** `F`=장내공시, `G`=코스닥공시, `2`=한경, `4`=이데일리, `5`=머니투데이, `6`=연합뉴스, `A`=매일경제 등

### Output (data)
```jsonc
{
  "stock_code": null,
  "items": [
    {
      "id": "cntt_usiq_srno 값",
      "provider": "F",
      "date": "20260706",
      "time": "093000",
      "title": "삼성전자 반기보고서 제출",
      "category": "1:FGHIN:공시"
    }
  ]
}
```

**캐시:** TTL **30초** (뉴스는 실시간성이 높음), key `FHKST01011800:{stock_code}:{date}:{time}`  
(date/time이 공백=현재기준인 경우 캐시키는 `FHKST01011800:{stock_code}:live`)

---

## 파일 수정 계획

```
src/tools/market.ts   ← registerMarketTools()에 3개 tool 추가
```

`server-factory.ts`는 `registerMarketTools(server, cfg)` 이미 호출 중 → 변경 불필요.

---

## 구현 순서

```
Step 1 — market_get_index
  구현: FHPUP02100000 (quote) + FHPUP02120000 (history) mode 분기
  검증: KOSPI/KOSDAQ/KOSPI200 각각 quote + history 호출 성공 확인

Step 2 — market_get_sector
  구현: FHKUP03500100, output1 snapshot + output2 rows
  검증: sector_code="0001" (종합) D/W/M/Y 각각 확인

Step 3 — market_get_news
  구현: FHKST01011800, 공백 파라미터 처리 주의
  검증: 전체 뉴스 / 특정 종목코드 필터 각각 확인
        모의계좌 미지원 → 실전 계좌 키 필요 명시
```

---

## 주의사항

- **모의투자 미지원:** 3개 tool 모두 실전 계좌 키(`kis.env = "real"`)에서만 동작. paper 환경에서 호출 시 `UPSTREAM_ERROR` 반환 예상.
- **`market_get_news` 공백 파라미터:** KIS API가 일부 파라미터를 "공백 필수 입력"으로 요구. `""` 전달 시 정상 동작, `undefined`/누락 시 오류 가능.
- **`market_get_sector` 업종코드:** KIS 포탈 FAQ "종목정보 다운로드(국내) - 업종코드" 참조. 주요 코드:  
  KOSPI 0001(종합), 0002(대형주), 0003(중형주), 0004(소형주) / KOSDAQ 1001 등.
