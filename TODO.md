# Todo

- **방송 설정(방제/카테고리/태그) 조회 및 변경 독**
  - **1. 인증 구현 (OAuth 2.0 방식)**
    - 사용자를 인증 페이지로 보내 `Authorization Code` 받기.
    - `Authorization Code`를 사용하여 `Access Token` 및 `Refresh Token` 발급받기.
    - `Access Token`은 유효기간(1일)이 짧으므로, `Refresh Token`(30일)을 사용하여 주기적으로 갱신하는 로직 필요.

  - **2. 설정 변경 기능 구현**
    - 발급받은 `Access Token`을 사용하여 `PATCH /open/v1/lives/setting` API 호출.
    - API 요청 본문에 변경할 `liveTitle`, `categoryType`, `categoryId`, `tags` 등을 포함하여 전송.
