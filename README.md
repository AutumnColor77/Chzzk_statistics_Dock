# Chzzk Viewer Dock

치지직 스트리머를 위한 방송 통계 & 설정 관리 독(Dock) 애플리케이션입니다.  
동시 시청자 수, 최고/평균 시청자, 팔로워를 실시간으로 표시하고, 방송 제목/카테고리/태그를 방송 중에도 손쉽게 변경할 수 있습니다.

---

## ✨ 주요 기능

- 📊 **실시간 통계**: 동시 시청자 수 / 최고 시청자 / 평균 시청자 / 팔로워
- ✏️ **방송 설정 변경**: 방송 제목, 카테고리(자동완성 검색), 태그를 실시간으로 수정 가능
- 🔒 **OAuth 2.0 로그인**: 치지직 공식 OAuth 인증 방식 사용
- 👁️ **수치 가리기**: 각 수치 클릭 시 숨김/표시 전환 (스트리밍 중 화면 보호)

---

## 🚀 Cloudflare Pages 배포 가이드

이 앱은 **Cloudflare Pages**에 배포하여 사용하는 것을 권장합니다.  
Cloudflare Pages Functions를 통해 API 키를 안전하게 서버에서 처리합니다.

### 1단계: 치지직 개발자 센터 앱 등록

1. [치지직 개발자 센터](https://developers.chzzk.naver.com/)에 접속합니다.
2. **애플리케이션 등록**을 통해 새 앱을 생성합니다.
3. **Client ID**와 **Client Secret**을 발급받아 안전한 곳에 보관합니다.
4. Redirect URI는 우선 임시로 아무 값이나 입력해두고, 배포 후 실제 URL로 수정합니다.

> [!NOTE]
> 앱 권한에 **유저 정보 조회**와 **방송 설정 변경** 권한이 반드시 포함되어야 합니다.

### 2단계: GitHub에 레포지토리 Fork 또는 Clone

```bash
git clone https://github.com/AutumnColor77/Chzzk_statistics_Dock.git
```

이 레포지토리를 여러분의 GitHub 계정에 Fork하거나, 직접 새 레포지토리로 Push합니다.

### 3단계: Cloudflare Pages 프로젝트 생성

1. [Cloudflare 대시보드](https://dash.cloudflare.com/)에 로그인합니다.
2. 좌측 메뉴에서 **Workers & Pages** → **Create application** → **Pages** 탭 선택.
3. **Connect to Git**을 선택하고 Git 계정을 연동한 뒤, 해당 레포지토리를 선택합니다.
4. 빌드 설정은 아래를 참고합니다.

| 설정 항목 | 값 |
|---|---|
| Framework preset | `None` |
| Build command | (비워두기) |
| Build output directory | `/` |

5. **Save and Deploy**를 클릭하면 배포가 시작됩니다. 배포가 완료되면 `*.pages.dev` 도메인이 발급됩니다.

### 4단계: 환경 변수 설정

Cloudflare Pages 프로젝트 설정에서 API 키를 등록합니다.

1. Cloudflare 대시보드 → 프로젝트 → **Settings** → **Environment variables** 탭으로 이동합니다.
2. 아래 두 변수를 **Production** (및 **Preview**) 환경에 추가합니다.

| 변수 이름 | 값 |
|---|---|
| `CHZZK_CLIENT_ID` | 1단계에서 발급받은 Client ID |
| `CHZZK_CLIENT_SECRET` | 1단계에서 발급받은 Client Secret |

3. 변수 추가 후 **재배포(Redeploy)**를 실행합니다.

### 5단계: 치지직 앱 Redirect URI 수정

1. Cloudflare에서 발급받은 URL을 확인합니다. (예: `https://chzzk-dock.pages.dev`)
2. [치지직 개발자 센터](https://developers.chzzk.naver.com/)로 돌아가 앱 설정에서 **Redirect URI**를 아래와 같이 수정합니다.

```
https://[배포된-도메인]/api/auth/callback
```

이제 배포된 URL로 접속해서 **치지직 계정 연동하기** 버튼을 클릭하면 바로 사용할 수 있습니다! 🎉

---

## 🗂️ 프로젝트 구조

```
Chzzk_statistics_Dock/
├── index.html                  # 메인 페이지
├── style.css                   # 스타일시트
├── js/                         # 클라이언트 JS 모듈
│   ├── main.js                 # 진입점 (초기화 및 이벤트 연결)
│   ├── state.js                # 전역 상태 관리
│   ├── api.js                  # Cloudflare Functions 통신
│   ├── auth.js                 # OAuth 로그인/로그아웃 처리
│   └── ui.js                   # DOM 업데이트 및 렌더링
└── functions/api/              # Cloudflare Pages Functions (서버사이드)
    ├── live-status.js          # 실시간 방송 상태 및 시청자 수 (비공식 폴링 API)
    ├── users/me.js             # 로그인 유저 채널 정보 조회
    ├── lives/setting.js        # 방송 설정 조회 및 변경
    ├── categories/search.js    # 카테고리 검색
    └── auth/
        ├── login.js            # OAuth 인증 시작 (Redirect)
        └── callback.js         # OAuth 콜백 (토큰 발급)
```

---

## ⚙️ `.env.example`

로컬 개발 환경이 필요한 경우 `.env.example` 파일을 참고하여 `.env` 파일을 생성하세요.

```bash
cp .env.example .env
```

---

## 📄 라이선스

본 프로젝트는 [MIT 라이선스](LICENSE)를 따릅니다.
