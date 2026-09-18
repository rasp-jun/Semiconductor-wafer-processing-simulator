# Review API v1

동일 출처 JSON API, 기본 주소 `http://127.0.0.1:8766/api`.

로그인 응답의 HttpOnly 쿠키로 인증합니다. 변경 요청은 `Content-Type: application/json`, `X-WaferFlow: review`, 로그인 또는 `/me` 응답의 `X-CSRF-Token`이 필요합니다. 초기 설정·로그인에는 CSRF 토큰을 요구하지 않지만 같은 출처와 전용 요청 헤더를 확인합니다.

| 메서드 / 경로 | 역할 | 동작 |
|---|---|---|
| GET `/status` | 공개 | 초기 설정 여부, 앱/모델 버전 |
| POST `/bootstrap` | localhost, 최초 1회 | 첫 관리자 계정 생성 |
| POST `/login` | 공개 | 세션 생성, 아이디+IP 기준 시도 제한 |
| GET `/me` | 로그인 | 사용자, CSRF, 입력 카탈로그 |
| POST `/logout` | 로그인 | 현재 세션 종료 |
| POST `/password` | 로그인 | 현재 비밀번호 확인 후 변경, 다른 세션 회수 |
| GET/POST `/users` | 관리자 | 계정 목록/생성 |
| POST `/users/:id/active` | 관리자 | 계정 활성화/비활성화, 세션 회수 |
| GET `/projects` | 로그인 | 조직의 프로젝트 목록 |
| POST `/projects` | 엔지니어·관리자 | 검토 프로젝트 생성 |
| GET `/projects/:id` | 로그인 | 레시피·버전·실험 결과 요약 |
| POST `/projects/:id/recipes` | 엔지니어·관리자 | 레시피와 r1 생성 |
| POST `/recipes/:id/revisions` | 엔지니어·관리자 | 최신 `base_revision_id`에서 새 버전 생성 |
| GET `/revisions/:id` | 로그인 | 조건, 시나리오, 모델 버전, 검토 상태 |
| POST `/revisions/:id/experiments` | 초안 작성자 | 합성 계산 또는 CSV 근거 추가 |
| GET `/experiments/:id` | 로그인 | 당시 원본 결과 전체 |
| POST `/revisions/:id/transition` | 상태/역할별 | `submit`, `approve`, `reject` |
| GET `/audit` | 로그인 | 조직 전체 최근 300개 변경 이벤트 |
| GET `/projects/:id/export` | 로그인 | 원본 결과·조건·검토 이력 JSON |

레시피 생성: `name`, `params`, `scenario`, `change_reason`. 새 버전에는 `base_revision_id` 추가. `params`의 항목·범위·간격은 `/me.catalog.fields`에 정의되어 있습니다. 파라미터를 누락하거나 범위를 벗어나면 저장하지 않습니다.

합성 실험: `kind: simulation`, `name`, `lot_id`, `seed`(선택). 결과를 클라이언트에서 제출해도 서버 결과로 다시 계산합니다. 작성 시 모델 버전이 현재 모델과 다르면 새 버전 생성을 요구합니다.

CSV 실험: `kind: measurement | demo`, `name`, `lot_id`, `source_name`, `csv`, `cd_lsl_nm`, `cd_usl_nm`. 원본 출처는 사용자 입력이며 진위가 인증되지는 않습니다. `measurement`와 `demo`가 다른 유형으로 저장됩니다.

상태 전환: `action`, `lock_version`, 검토 판정에는 필수 `note`. 제출된 버전은 조건과 근거를 모두 고정합니다. 승인·반려 후 내용을 고치려면 새 버전이 필요합니다.

에러는 `{ "error": "설명" }`. 401 로그인, 403 역할/CSRF, 404 항목 없음, 409 버전·상태 충돌, 413 용량 초과, 415 형식 오류, 422 데이터 검증, 429 로그인 제한, 503 DB 처리 실패입니다. 동일 변경안을 다시 제출하기 전에 409/타임아웃에서는 최신 서버 상태를 확인합니다.
