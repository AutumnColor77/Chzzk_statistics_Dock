# Cheese Stick Dock

현재 버전: **v0.4.2**

**Cheese Stick Dock**은 치지직 스트리머를 위한 설정 관리 & 방송 통계 독(Dock) 애플리케이션입니다.  
동시 시청자 수, 최고/평균 시청자, 팔로워를 실시간으로 표시하고, 방송 제목/카테고리/태그를 방송 중에도 손쉽게 변경할 수 있습니다.

특히 **고가용성 아키텍처 리팩토링**을 통해 많은 클라이언트가 접속하더라도 안정적인 서비스 제공이 가능하도록 최적화되었습니다.

---

## ✨ 주요 기능

- ✏️ **방송 설정 변경**: 방송 제목, 카테고리(자동완성 검색), 태그를 실시간으로 수정 가능
- 📊 **실시간 통계**: 동시 시청자 수 / 최고 시청자 / 평균 시청자 / 팔로워
- 📈 **운영자 전용 일일 지표**: `/admin`에서 오늘·30일 DAU/방문/신규·재방문 확인 (본인 치지직 채널만, 공개 UI에 링크 없음)
- 🔒 **OAuth 2.0 로그인**: 치지직 공식 OAuth 인증 방식 사용
- 👁️ **수치 가리기**: 각 수치 클릭 시 숨김/표시 전환 (스트리밍 중 화면 보호)
- ⚡ **최적화된 아키텍처**: KV 캐싱, Jitter 폴링, LocalStorage 폴백 적용
- 🛡️ **강화된 보안**: HttpOnly 세션 쿠키, CSRF + Origin 이중 방어, SSRF/Open-Proxy 차단, 입력값 화이트리스트 검증, 엄격한 CSP(`'unsafe-inline'` 제거), HSTS/COOP(`same-origin-allow-popups`)/CORP, 세션 무효화(Revoke) 실패 명시 응답, 공개 API IP당 요청 제한, 안전 로깅(쿼리스트링 미기록)

---

## 🏗️ 아키텍처 및 최적화 (SPOF 제거)

본 서비스는 플랫폼의 이상 탐지 시스템에 의한 IP 차단을 방지하고 서버 자원을 최적화하기 위해 다음 기술이 적용되어 있습니다.

1.  **Cloudflare KV 캐싱 (SWR 패턴)**: 서버(Functions) 레이어에서 치지직 API 호출 결과를 중앙 집중형 전역 저장소(KV)에 캐싱합니다. 동일 채널 요청은 25초간 캐시에서 즉시 반환하며, 25~60초 사이에는 캐시 반환 후 백그라운드에서만 origin 갱신을 수행합니다 (Stale-While-Revalidate).
2.  **클라이언트 Jitter 폴링**: 모든 클라이언트가 정확히 30초마다 요청하여 발생하는 트래픽 스파이크를 방지하기 위해, 폴링 주기에 ±5초의 난수(Jitter)를 부여합니다. (실제 요청 주기: 25~35초 분산)
3.  **LocalStorage 방어 로직**: KV 할당량 초과나 서버 연결 불안정 시, 클라이언트의 LocalStorage 캐시(최근 2분)로 자동 우회하여 서비스 중단을 방지합니다.

---

## 🚦 상태 인디케이터 (Status Dot)

상단 채널명 옆의 원형 아이콘을 통해 데이터의 상태를 직관적으로 확인할 수 있습니다.

- 🟢 **초록색**: 정상. 서버로부터 최신 데이터를 수신 중입니다.
- 🟠 **주황색 (펄스)**: 경고. 서버 연결 불안정으로 인해 **로컬 캐시** 데이터를 표시 중입니다.
- 🔴 **빨간색 (펄스)**: 에러. 서버 및 로컬 캐시 모두 데이터를 가져올 수 없는 상태입니다.

---

## 🔐 보안 모델 (v0.4.1)

### 인증 / 세션
- 인증 토큰은 브라우저 `localStorage`/`sessionStorage`에 **절대 저장하지 않습니다**. 서버가 KV(`SESSION_STORE` 권장)에 저장하고, 클라이언트에는 `HttpOnly + Secure + SameSite=Lax` 세션 쿠키만 전달합니다.
- 세션 ID는 256bit 무작위(`crypto.getRandomValues`), CSRF 토큰은 192bit. CSRF 비교는 **timing-safe**.
- OAuth `state`는 `HttpOnly + Path=/api/auth` 쿠키에 저장한 256bit 무작위 값으로, 콜백에서 timing-safe 검증.
- 콜백 성공 시 세션 쿠키를 설정한 뒤 **`/?oauth_complete=1`로 리다이렉트**합니다. 별도 팝업·`window.close()`에 의존하지 않습니다.

### OAuth 로그인 (v0.4.2~)
- **같은 탭 리다이렉트**: 연동 버튼 → 치지직 로그인 → 콜백 → 메인 페이지(`/?oauth_complete=1`)로 복귀 후 대시보드 표시.
- 브라우저가 OAuth 팝업의 `window.close()`를 막는 환경에서도 안정적으로 동작합니다.

### CSRF / Origin 이중 방어
- 상태 변경 API(`PATCH /api/lives/setting`, `POST /api/auth/revoke`)는 다음을 모두 통과해야 합니다.
  1. CSRF 토큰(`X-CSRF-Token` 헤더 + `chzzk_csrf` 쿠키 + 세션 저장값) 3중 일치.
  2. **Origin 헤더 화이트리스트 검증** (세션 부재 시 우회되던 logout-CSRF도 차단).
- 인증된 GET 엔드포인트(`/api/users/me`, `/api/lives/setting`, `/api/categories/search`)는 `Sec-Fetch-Site` 메타데이터 검증으로 cross-site 트리거를 차단합니다.

### 입력 검증 / SSRF
- `live-status`의 `channelId`는 `^[a-f0-9]{10,64}$` 검증으로 SSRF/경로 주입 차단.
- `lives/setting PATCH`는 화이트리스트 + **타입/길이/enum/배열 크기**까지 검증 (제목 100자, 태그 10개·각 30자, `categoryType ∈ {GAME,SPORTS,ETC}`, `categoryId` 형식 검사). 본문은 8KB 상한.
- `categories/search`의 query는 1~60자만 허용. **세션 인증 사용자만 호출 가능**(Open API 자격증명 남용 방지)이며, 동일 query 응답을 60초간 KV 캐싱.

### 토큰 폐기(revoke) 보장
- 외부 폐기 API 실패 시에도 **로컬 세션을 삭제**하지만, 응답을 `502`로 명시해 사용자가 재시도/인지할 수 있게 합니다.

### 보안 헤더
- 정적 자산(`_headers`): `default-src 'self'`, `script-src 'self'`, `frame-ancestors 'none'`, HSTS, **COOP `same-origin-allow-popups`**, CORP, Permissions-Policy, X-Frame-Options.
- 모든 함수 응답은 동일한 보안 헤더 세트를 코드에서 직접 부착(`applyDefaultSecurityHeaders`, COOP 포함).

### 안전 로깅
- 보안 이벤트 로그는 `request.url` 전체 대신 `pathname`만 기록합니다 → OAuth `code`/`state`, `query` 같은 민감 파라미터가 로그에 남지 않습니다.

### 트래픽 제한 (공개 배포 시)

| 엔드포인트 | 기준 (동일 IP, 60초 창) |
|------------|-------------------------|
| `GET /api/live-status` | 분당 120회 |
| 위 요청 중 `force=true` | **로그인 필수** + 분당 30회 (캐시 우회·오리진 직접 호출) |
| `GET /api/categories/search` | **로그인 필수** + 분당 60회 (응답 60초 KV 캐싱) |
| `GET /api/admin/metrics` | **운영자(ADMIN_CHANNEL_ID)만** + 분당 30회 |
| `GET /api/users/me`, `/api/lives/setting` | 분당 120회 |
| `PATCH /api/lives/setting` | 분당 30회 |
| `POST /api/auth/revoke` | 분당 20회 |
| `GET /api/auth/login`, `/api/auth/callback` | 분당 20~30회 |

초과 시 HTTP **429**와 `Retry-After: 60` 헤더, JSON 오류 본문을 반환합니다. 통계 조회는 클라이언트가 최근 **로컬 캐시**(약 2분)로 폴백할 수 있습니다.

> **주의**: KV 기반 카운터는 race condition과 eventual consistency 한계가 있으므로, 결정적인 차단이 필요한 경우 **Cloudflare WAF Rate Limiting Rules / Turnstile**을 함께 적용하세요. CF-Connecting-IP 헤더가 없는 요청(=Cloudflare 프록시를 거치지 않은 요청)은 보수적으로 차단합니다.

### 후원 링크 (선택)

메인 페이지 하단 푸터에 운영 안내 및 투네이션 링크가 있습니다. Fork 후 자체 배포 시 [`index.html`](index.html)의 `<footer class="site-footer">` 안 `<a href="...">`를 본인 후원 페이지 URL로 바꾸면 됩니다.

### 로컬에 남는 정보

- `chzzkChannelId`: 채널 식별자(편의용)
- `chzzk_live_status_cache`: 통계 폴백 캐시(약 2분)
- `chzzk_peak_viewers`: 최고 시청자 수(세션 UI 용도)
- `value-hidden-*`: 값 가리기 UI 상태

### 운영 체크리스트

1. KV 바인딩 `LIVE_STATUS_CACHE`(통계 캐시)와 `SESSION_STORE`(세션 전용)를 **분리해서** 모두 설정.
2. 환경 변수 `CHZZK_CLIENT_ID`, `CHZZK_CLIENT_SECRET` 설정 확인.
3. `ALLOWED_ORIGIN`을 본인의 배포 도메인으로 명시 설정(여러 개는 공백 구분).
4. **HTTPS 환경에서만 배포** (`Secure` 쿠키, HSTS).
5. (권장) Cloudflare WAF에서 `/api/*`에 대한 Rate Limiting Rules 또는 Turnstile 적용으로 KV 카운터의 race condition 한계를 보완.
6. 배포 후 **OAuth 로그인**(치지직 연동 → 메인 대시보드 전환)/새로고침/로그아웃/설정변경 시나리오 점검.
7. 이슈 발생 시 세션 KV 키(`session:*`) 삭제 후 재검증, 토큰 폐기는 치지직 개발자 센터에서도 강제 만료 가능.
8. `console.log`(`[security] ...`) 모니터링 항목: `oauth_state_mismatch`, `csrf_validation_failed*`, `origin_validation_failed_*`, `rate_limit_*`, `*_unauthenticated`, `*_misconfigured`, `session_store_missing`, `admin_metrics_*`.
9. 운영자 지표를 쓰려면 `ADMIN_CHANNEL_ID`에 **본인 치지직 채널 ID**를 넣고 재배포한 뒤 `https://your-app.pages.dev/admin`으로 접속합니다. 채널 ID는 치지직 채널 URL의 hex 값이거나, 독 로그인 후 Local Storage의 `chzzkChannelId`입니다.

### 문제 해결: `Session store is not configured.`

| 원인 | 조치 |
|------|------|
| KV 바인딩 없음 | 위 **4단계**대로 `LIVE_STATUS_CACHE`(필수) 바인딩 추가 후 재배포 |
| Variable name 오타 | `LIVE_STATUS_CACHE` / `SESSION_STORE` 철자·대소문자 일치 확인 |
| Preview만 설정됨 | Production 환경에도 동일 바인딩 추가 |
| 바인딩 후 미반영 | Pages에서 **Retry deployment** 실행 |
| **예전엔 됐는데 갑자기 안 됨** | `wrangler.toml`에 `pages_build_output_dir`만 있고 `kv_namespaces`가 비어 있으면, Git 배포가 **대시보드 KV 설정을 빈 값으로 덮어쓸 수 있습니다**. 이 저장소는 KV를 **대시보드에서만** 관리합니다(`pages_build_output_dir` 미사용). KV를 다시 연결한 뒤 재배포하세요. |

> **왜 풀렸나?** Cloudflare Pages는 `pages_build_output_dir`가 있는 `wrangler.toml`로 배포할 때, 파일에 적힌 바인딩이 **설정의 기준**이 됩니다. KV가 주석 처리된 채로 푸시되면, 예전에 대시보드에 묶어둔 `LIVE_STATUS_CACHE` / `SESSION_STORE`가 배포 과정에서 반영되지 않을 수 있습니다. 코드가 KV를 삭제한 것은 아닙니다.

---

## 🚀 Cloudflare Pages 배포 가이드

이 앱은 **Cloudflare Pages**에 배포하여 사용하는 것을 권장합니다.  

### 1단계: 치지직 개발자 센터 앱 등록
1. [치지직 개발자 센터](https://developers.chzzk.naver.com/)에서 앱을 등록하고 **Client ID**와 **Client Secret**을 발급받습니다.
2. 앱 권한에 **유저 정보 조회**와 **방송 설정 변경** 권한을 포함합니다.

### 2단계: GitHub에 레포지토리 Fork 또는 Clone
```bash
git clone https://github.com/<your-github-id>/cheese-stick-dock.git
```

### 3단계: Cloudflare Pages 프로젝트 생성
1. [Cloudflare 대시보드](https://dash.cloudflare.com/) → Workers & Pages → Create application → Pages.
2. 레포지토리 연동 후 빌드 설정을 다음과 같이 입력합니다:
   - Framework preset: `None` / Build command: (비워두기) / Build output directory: `/`

### 4단계: KV Namespace 설정 (필수 — 로그인에 반드시 필요)
OAuth 로그인·세션 쿠키는 Cloudflare **KV**에 저장됩니다. 바인딩이 없으면 로그인 콜백에서 `Session store is not configured.`(503)가 발생합니다.

1. Cloudflare 대시보드 → Workers & Pages → **KV** → **Create namespace** (이름은 자유, 아래 **Variable name**만 정확히 맞추면 됩니다).
   - 통계 캐시용 namespace 1개
   - (권장) 세션 전용 namespace 1개 — `SESSION_STORE`와 분리
2. Pages 프로젝트 → **Settings** → **Functions** → **KV namespace bindings** → **Add binding**
3. **Production**과 **Preview** 환경 모두에 아래를 추가합니다.

| Variable name (정확히 일치) | 용도 |
|-----------------------------|------|
| `LIVE_STATUS_CACHE` | 통계 API 캐시 + 세션 폴백 |
| `SESSION_STORE` | 세션 전용 (권장, 없으면 `LIVE_STATUS_CACHE`로 폴백) |

4. 저장 후 **Deployments** → 최신 배포 **Retry deployment** 또는 `main`에 다시 푸시해 Functions 바인딩을 반영합니다.

> **로컬 개발**: `wrangler pages dev . --kv LIVE_STATUS_CACHE --kv SESSION_STORE`

### 5단계: 환경 변수 설정
1. Pages 프로젝트 → **Settings** → **Environment variables** 탭으로 이동합니다.
2. `CHZZK_CLIENT_ID`와 `CHZZK_CLIENT_SECRET`을 추가합니다.
3. **`ALLOWED_ORIGIN`을 본인의 배포 도메인으로 명시 설정**합니다(예: `https://your-app.pages.dev`). 보안상 명시적 화이트리스트를 강력 권장하며, 여러 개는 공백으로 구분합니다.
4. (선택) **`ADMIN_CHANNEL_ID`**에 본인 치지직 채널 ID를 넣으면 `/admin`에서 일일 사용자 지표를 볼 수 있습니다. 미설정 시 해당 페이지는 403입니다. 여러 운영자는 공백으로 구분합니다.
5. 모든 설정을 마친 후 **재배포(Redeploy)**합니다.

### 6단계: 치지직 앱 Redirect URI 수정
[치지직 개발자 센터]에서 Redirect URI를 아래 형식으로 수정합니다.
`https://your-app.pages.dev/api/auth/callback`

---

## 🗂️ 프로젝트 구조

```
Cheese-Stick-Dock/
├── index.html                  # 메인 페이지 (인라인 스크립트/스타일 없음)
├── admin/index.html            # 운영자 전용 일일 지표 (공개 UI에 링크 없음)
├── style.css                   # 스타일시트 (콜백 페이지 스타일 포함)
├── wrangler.toml               # Cloudflare Pages 설정 및 KV 바인딩 안내
├── _headers                    # 보안 헤더 설정 (엄격 CSP, HSTS, COOP/CORP 등)
├── js/                         # 클라이언트 JS 모듈
│   ├── main.js                 # 진입점 (Jitter 폴링 및 상태 관리)
│   ├── api.js                  # API 통신 (LocalStorage 폴백 & CSRF 헤더 강제)
│   ├── auth.js                 # OAuth 리다이렉트 로그인 및 oauth_complete 복귀 처리
│   ├── admin.js                # 운영자 지표 페이지
│   ├── ui.js                   # UI 갱신·카테고리 자동완성 등 (XSS 안전)
│   └── state.js                # 전역 상태 (dataSource 및 로컬 상태 정리)
└── functions/
    ├── _lib/security.js        # 세션/CSRF/Origin/Sec-Fetch/Rate Limit/안전 로깅 헬퍼
    ├── _lib/metrics.js         # 일일 DAU 집계 (채널 ID 해시만 저장)
    └── api/
        ├── live-status.js      # 라이브 상태 조회 (KV SWR, SSRF 방어, force=세션 필요)
        ├── categories/search.js  # 카테고리 검색 (세션 인증 필수, KV 응답 캐싱)
        ├── lives/setting.js      # 방송 설정 (입력 검증, CSRF + Origin 이중 방어)
        ├── users/me.js           # 내 채널 정보 (Sec-Fetch-Site 검증, DAU 기록)
        ├── admin/metrics.js      # 운영자 전용 지표 조회
        ├── auth/login.js         # OAuth 로그인 시작 (256bit state)
        ├── auth/callback.js      # OAuth 콜백 (외부 스크립트 + 엄격 CSP)
        └── auth/revoke.js        # 세션/토큰 폐기 (실패 명시 응답)
```

### 운영자 일일 지표 (`/admin`)

- 집계 대상은 **치지직 로그인에 성공한 사용자**입니다. 독 페이지를 연 횟수가 오늘 방문, 같은 날 처음 확인된 채널이 DAU입니다.
- 날짜 경계는 **한국 시간(KST)** 입니다. 일자별 기록은 약 90일 후 KV에서 만료됩니다.
- 채널 ID는 SHA-256 해시로만 저장하며, 지표 API는 개인 식별 값을 내려주지 않습니다.
- 메인 화면에는 링크를 두지 않습니다. `ADMIN_CHANNEL_ID`와 로그인한 채널이 일치할 때만 데이터가 보입니다.

---

## 📄 라이선스

본 프로젝트는 [MIT 라이선스](LICENSE)를 따릅니다.
