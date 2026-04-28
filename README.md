# Chzzk Live Dock

현재 버전: **v0.3.1**

치지직 스트리머를 위한 방송 통계 & 설정 관리 독(Dock) 애플리케이션입니다.  
동시 시청자 수, 최고/평균 시청자, 팔로워를 실시간으로 표시하고, 방송 제목/카테고리/태그를 방송 중에도 손쉽게 변경할 수 있습니다.

특히 **고가용성 아키텍처 리팩토링**을 통해 많은 클라이언트가 접속하더라도 안정적인 서비스 제공이 가능하도록 최적화되었습니다.

---

## ✨ 주요 기능

- 📊 **실시간 통계**: 동시 시청자 수 / 최고 시청자 / 평균 시청자 / 팔로워
- ✏️ **방송 설정 변경**: 방송 제목, 카테고리(자동완성 검색), 태그를 실시간으로 수정 가능
- 🔒 **OAuth 2.0 로그인**: 치지직 공식 OAuth 인증 방식 사용
- 👁️ **수치 가리기**: 각 수치 클릭 시 숨김/표시 전환 (스트리밍 중 화면 보호)
- ⚡ **최적화된 아키텍처**: KV 캐싱, Jitter 폴링, LocalStorage 폴백 적용
- 🛡️ **강화된 보안**: HttpOnly 세션 쿠키, CSRF/XSS/SSRF 방어, HSTS/CSP 보안 헤더, 세션 무효화(Revoke) 로직

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

## 🔐 보안 모델 (v0.3.1+)

- 인증 토큰은 브라우저 `localStorage`/`sessionStorage`에 저장하지 않습니다.
- OAuth 콜백 후 서버가 세션을 KV에 저장하고, 클라이언트에는 `HttpOnly + Secure + SameSite` 세션 쿠키만 전달합니다.
- 상태 변경 API(`PATCH /api/lives/setting`, `POST /api/auth/revoke`)는 CSRF 토큰(`X-CSRF-Token`) 검증을 통과해야 합니다.
- 인증/설정 엔드포인트는 `no-store` 캐시 정책 및 rate limiting(경량)을 적용합니다.

### 로컬에 남는 정보

- `chzzkChannelId`: 채널 식별자(편의용)
- `chzzk_live_status_cache`: 통계 폴백 캐시(약 2분)
- `chzzk_peak_viewers`: 최고 시청자 수(세션 UI 용도)
- `value-hidden-*`: 값 가리기 UI 상태

### 운영 체크리스트

1. KV 바인딩 `LIVE_STATUS_CACHE` 또는 `SESSION_STORE`가 설정되어 있는지 확인
2. 환경 변수 `CHZZK_CLIENT_ID`, `CHZZK_CLIENT_SECRET` 설정 확인
3. HTTPS 환경에서만 배포(`Secure` 쿠키 사용)
4. 배포 후 로그인/새로고침/로그아웃/설정변경 시나리오 점검
5. 이슈 발생 시 세션 관련 KV 키(`session:*`) 삭제 후 재검증

---

## 🚀 Cloudflare Pages 배포 가이드

이 앱은 **Cloudflare Pages**에 배포하여 사용하는 것을 권장합니다.  

### 1단계: 치지직 개발자 센터 앱 등록
1. [치지직 개발자 센터](https://developers.chzzk.naver.com/)에서 앱을 등록하고 **Client ID**와 **Client Secret**을 발급받습니다.
2. 앱 권한에 **유저 정보 조회**와 **방송 설정 변경** 권한을 포함합니다.

### 2단계: GitHub에 레포지토리 Fork 또는 Clone
```bash
git clone https://github.com/AutumnColor77/Chzzk-Live-Dock.git
```

### 3단계: Cloudflare Pages 프로젝트 생성
1. [Cloudflare 대시보드](https://dash.cloudflare.com/) → Workers & Pages → Create application → Pages.
2. 레포지토리 연동 후 빌드 설정을 다음과 같이 입력합니다:
   - Framework preset: `None` / Build command: (비워두기) / Build output directory: `/`

### 4단계: KV Namespace 설정 (필수)
안정적인 캐싱 기능을 위해 KV 스토리지를 연결해야 합니다.
1. Cloudflare 대시보드 → Workers & Pages → **KV** → **Create namespace**. 이름을 `LIVE_STATUS_CACHE` 또는 원하는 이름으로 생성합니다.
2. 생성된 Pages 프로젝트 → **Settings** → **Functions** → **KV namespace bindings**으로 이동합니다.
3. **Variable name**에 `LIVE_STATUS_CACHE`를 입력하고, 방금 생성한 KV namespace를 선택합니다.
4. (권장) 세션 분리를 위해 `SESSION_STORE` 바인딩을 추가하고 별도 namespace를 연결합니다.

### 5단계: 환경 변수 설정
1. Pages 프로젝트 → **Settings** → **Environment variables** 탭으로 이동합니다.
2. `CHZZK_CLIENT_ID`와 `CHZZK_CLIENT_SECRET`을 추가합니다.
3. (선택) `ALLOWED_ORIGIN`에 본인의 배포 도메인(예: `https://your-app.pages.dev`)을 입력하여 CORS 오리진을 제한합니다. (미설정 시 현재 도메인 자동 사용)
4. 모든 설정을 마친 후 **재배포(Redeploy)**합니다.

### 6단계: 치지직 앱 Redirect URI 수정
[치지직 개발자 센터]에서 Redirect URI를 아래 형식으로 수정합니다.
`https://[배포된-도메인]/api/auth/callback`

---

## 🗂️ 프로젝트 구조

```
Chzzk-Live-Dock/
├── index.html                  # 메인 페이지
├── style.css                   # 스타일시트
├── wrangler.toml               # Cloudflare Pages 설정 및 KV 바인딩 안내
├── _headers                    # 보안 헤더 설정 (CSP, HSTS, X-Frame-Options 등)
├── js/                         # 클라이언트 JS 모듈
│   ├── main.js                 # 진입점 (Jitter 폴링 및 상태 관리)
│   ├── api.js                  # API 통신 (LocalStorage 폴백 & CSRF 헤더)
│   ├── auth.js                 # OAuth 팝업 및 메시지 리스너 (Origin 검증)
│   └── state.js                # 전역 상태 (dataSource 및 로컬 상태 정리)
└── functions/api/              # Cloudflare Pages Functions
    ├── live-status.js          # 라이브 상태 조회 (KV SWR 캐싱 & SSRF 방어)
    ├── lives/setting.js        # 방송 설정 변경 (입력값 화이트리스트 검증)
    ├── auth/callback.js        # OAuth 콜백 (세션 쿠키 발급)
    └── auth/revoke.js          # 세션/토큰 무효화 API
```

---

## 📄 라이선스

본 프로젝트는 [MIT 라이선스](LICENSE)를 따릅니다.
