# Cheese Stick Dock Release Notes

제품 소개 문구: **Cheese Stick Dock**은 치지직 스트리머를 위한 설정 관리 & 방송 통계 독(Dock) 애플리케이션입니다.

## v0.4.1

배포일: 2026-06-02

### 변경 사항
- OAuth 로그인 팝업이 치지직 연동 완료 후에도 닫히지 않던 문제를 수정했습니다.
- 메인 창이 팝업 `Window` 참조를 유지하고, 인증 성공 시 부모 창에서 `close()`를 호출합니다.
- 이미 열린 로그인 팝업이 있으면 새 창 대신 기존 팝업에 포커스를 줍니다.
- `Cross-Origin-Opener-Policy`를 `same-origin-allow-popups`로 조정해, OAuth 중 외부 origin 이동 후에도 opener 통신·팝업 닫기가 유지되도록 했습니다 (`_headers`, `applyDefaultSecurityHeaders`).
- `postMessage` 수신 시 열린 팝업과 `event.source`가 일치할 때만 처리하도록 검증을 강화했습니다.

### 사용자 영향
- 치지직 계정 연동 후 로그인 팝업이 자동으로 닫히고 메인 화면(대시보드)으로 전환됩니다.
- 보안 모델(CSP, HttpOnly 세션, CSRF/Origin 검증)은 유지되며, COOP만 OAuth 팝업 흐름에 맞게 완화되었습니다.

### 배포 시 확인
- Cloudflare Pages에 배포 후 **팝업 로그인 → 팝업 자동 닫힘 → 통계/설정 표시**를 한 번 확인하세요.
