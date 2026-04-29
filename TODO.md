# Cheese Stick Dock Todo

- [x] **1. 인증 구현 (OAuth 2.0 방식)**
  - [x] 사용자를 인증 페이지로 보내 `Authorization Code` 받기.
  - [x] `Authorization Code`를 사용하여 `Access Token` 발급받기.
  - [ ] `Refresh Token`(30일)을 사용하여 주기적으로 갱신하는 로직 (현재는 만료 시 재로그인 필요).

- [x] **2. 설정 변경 기능 구현**
  - [x] 발급받은 `Access Token`을 사용하여 `PATCH /open/v1/lives/setting` API 호출.
  - [x] API 요청 본문에 변경할 `liveTitle`, `categoryType`, `categoryId`, `tags` 등을 포함하여 전송.

- [x] **3. 보안 강화 (완료)**
  - [x] XSS, CSRF(state), SSRF(channelId) 방어 로직 적용.
  - [x] CSP, HSTS, X-Frame-Options 등 보안 헤더 설정.
  - [x] 토큰 무효화(Revoke) 기능 구현.

- [ ] **4. 향후 과제**
  - [ ] **Refresh Token 자동 갱신**: Access Token 만료 전 백그라운드에서 갱신.
  - [ ] **UI/UX 고도화**: 더 풍부한 애니메이션 및 다크 모드 테마 최적화.
  - [ ] **에러 핸들링 세분화**: API 오류 시 사용자에게 더 친절한 안내 메시지 제공.
