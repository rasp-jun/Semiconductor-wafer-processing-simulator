# STRATUM — 반도체 공정 스튜디오

> **2026-09-29 저장 지점:** 요청에 따라 추가 개발을 중지하고 현재 작업을 보관했습니다. 실행 가능한 버전에는 STRATUM UI·18종 장비·CMOS 세부 공정 선택/검색 개선까지 반영되어 있습니다. `cmos-window-core.js`, `cmos-window-ui.js`, `briefing.html`, `stratum-briefing.css`, `stratum-briefing.js`는 **미통합 개발 초안**으로, 현재 앱·공개 배포 목록에 연결하지 않았습니다. 다음 재개 작업은 [CHECKPOINT.md](CHECKPOINT.md)에 기록했습니다.

## 2026-09-29 · UI 시스템 개편 (디자인 토큰 · 공통 셸 · CMOS 스튜디오)

9개 작업 공간이 **하나의 내비게이션 레일과 페이지 헤더**를 공유합니다. 페이지마다 달랐던 사이드바·상단 탭·작업 공간 메뉴를 대체하며, 레일은 아이콘으로 접을 수 있고 900px 미만에서는 메뉴 버튼으로 여는 서랍이 됩니다. 보조 파일 작업은 헤더의 더보기 메뉴로 모았습니다.

CMOS 스튜디오는 공학 시뮬레이션 도구의 **공정 트리 | 3D 장비 | 레시피 검사기** 배치를 따릅니다. 1100×600 이상에서는 117개 공정 목록이 장비 옆에 고정되고, 레시피와 실행 버튼은 스크롤해도 보입니다. 1366×860 화면에서 장비 화면 시작 위치가 586px → 185px, 390px 휴대폰에서 726px → 492px로 올라왔습니다. 세부 공정 선택은 도킹된 목록 상단에 항상 표시됩니다. 좁거나 낮은 화면(1100×600 미만)은 기존 공정 목록 대화상자·모듈 바로가기·하단 실행 바를 사용합니다.

- **토큰** `stratum-tokens.css`: 색(중립·코발트·시그널·상태), 글자 크기, 간격, 모서리, 그림자. 어두운 장비 화면 안에서는 보조 글자색을 밝게 다시 지정해 명암비를 유지합니다.
- **셸·컴포넌트** `stratum-shell.js`, `stratum-ui.css` · **CMOS 배치** `stratum-ui-cmos.css`.
- **캐스케이드:** 기존 스타일시트는 `@layer legacy` 안에 있습니다. 새 규칙은 레이어 밖에 있어 선택자 경쟁 없이 우선합니다. 페이지 스크립트가 쓰는 요소 ID는 바꾸지 않았습니다.
- **기존 CSS 정리** `tools/ui_tokens.py`: 3,060개 색 리터럴을 같은 색상 계열의 가장 가까운 토큰으로, 11px 미만 글자 1,354곳을 가독 하한(라벨 11px·본문 12px)으로 옮겼습니다. SVG `fill`/`stroke`, `url()`, SVG 글자 크기는 그대로 둡니다.
- 포토 실험은 콘텐츠 영역 안에서 토큰 명암을 뒤집어 밝은 화면으로 전환했고, 3D 장비 화면은 어두운 계기 색을 유지합니다.

## 2026-09-29 · 제품 이름과 작업 화면 개편

웹사이트의 표시 이름을 **STRATUM(스트라텀)**으로 통일했습니다. 공정 층을 나타내는 심벌, 공통 작업 공간 메뉴, 인쇄·다운로드 보고서까지 연결합니다. 기존 `waferflow-*` 저장 키·파일 형식·API 식별자는 호환성을 위해 유지합니다.

CMOS 스튜디오는 데스크톱의 세로 공정 순서, 중앙 3D 장비, 밝은 레시피 입력부로 구성합니다. 단면·결과·검토실·장비 라이브러리에도 같은 디자인을 적용합니다. 모바일에서는 공정 순서를 가로로 탐색하며 선택된 단계가 자동으로 보입니다. 장비 화면에 포커스가 있을 때 **Space**는 실행/정지, **1–4**는 카메라 전환입니다. 키보드 카메라 선택 상태는 보조 기술에도 전달됩니다.

공통 디자인: `stratum.css`, `stratum-shell.js` · CMOS 작업대: `stratum-cmos.css`. 교육·데모 제공 범위와 상용 출시 전 남은 항목은 [STRATUM_RELEASE.md](STRATUM_RELEASE.md)를 참조하세요.

CMOS 공정 제목 아래 **세부 공정 선택**에서 117개 공정을 직접 고를 수 있습니다. **117개 전체 목록**은 검색·상태 필터를 제공하며 마지막 공정까지 스크롤합니다. 선택하면 해당 장비·조건을 표시하고, 실제 실행은 실행 버튼으로 시작합니다.

공정 검색은 `117`, `OP 7`, `STI etch`처럼 번호나 여러 검색어를 지원합니다. 검색 결과가 하나일 때 **Enter**로 선택하고, **↓**로 첫 결과에 이동할 수 있습니다. 검색 지우기는 상태 필터를 유지하며, **조건 초기화**는 검색과 필터를 함께 해제합니다. 다른 공정을 둘러본 뒤 선택창의 **OP… 실행 단계로** 버튼으로 다음 실행 공정에 복귀할 수 있습니다. 완료 기록·미실행·다음 실행을 구분해서 표시하고, 낮은 화면에서는 목록 상단을 압축합니다.

## AXIS 장비 edition 03 · 18종 독립 외형

장비 전체 외형을 다시 제작했습니다. 공통 전면 캐비닛 중심의 형태를 수직 열처리 타워, 적층 트랙, 방사형 진공 챔버, 이온 빔라인, 회전 연마부, 광학 프레임, 돌출형 테스트 헤드로 구분합니다. 장비마다 내부 보조 기구와 기본 관찰 시점도 다릅니다.

상단 **장비 도감**에서 외관/내부 렌더 36장을 확인하고 ‘빔라인’, ‘전구체’, ‘열처리’ 같은 특징으로 검색할 수 있습니다. **내부 구조**를 끄고 실행하면 장비 전체 외관에서, 켜고 실행하면 내부 기구에서 공정을 관찰합니다. 실행·재개·한 동작 진행·연속 실행은 선택한 보기를 유지합니다. 외관 본 화면에서 웨이퍼와 반송 포크가 장비별 로드포트에서 처리부로 이동하며, 반투명 **웨이퍼 추적 렌즈 ×1.6**가 가려지는 위치의 동작도 보여줍니다. 실제 가공면 확대, 단계별 진행, 로드포트 상태등을 함께 제공합니다.

모델 생성: `tools/equipment_identity.py` · 구조와 재생성 방법: [장비 자산 문서](assets/cmos/README.md) · 실제 화면 검증: [QUALITY.md](QUALITY.md).


## 2026-09-28 · AXIS 실험 검토실

CMOS 상단의 **실험 검토실**에서 같은 공정 시점의 두 실험을 검토하고 전달할 수 있습니다.

- 산화 시간, 폴리 게이트 식각 시간, CMP 시간의 세 예제를 실제 엔진으로 계산합니다. 활성 웨이퍼와 저장 기록은 바꾸지 않습니다.
- 작업 중인 두 웨이퍼는 **결과 · 비교 → 실험 결과 비교 → 검토실에서 열기**로 가져옵니다. 선택한 공통 완료 시점만 포함하며 실행 전 초안은 제외합니다.
- 표면 높이 / 차이 그래프, 마우스·키보드 위치 탐색, 정확한 실행 조건 차이, 구조 지표, 경고, 검토 메모를 제공합니다.
- **검토 패키지**는 JSON, **검토 보고서**는 독립 HTML입니다. HTML을 브라우저에서 열어 인쇄 메뉴로 PDF를 저장할 수 있습니다.
- 검토 JSON을 다시 열면 SHA-256, 모델 버전, 양쪽 전체 완료 이력의 재계산 결과를 확인합니다. 체크섬은 작성자 인증·승인 서명이 아닙니다. 예제와 계산은 미보정 교육 모델입니다.
- 검토 중인 메모는 같은 페이지에서 창을 닫았다 열어도 유지됩니다. 새로고침 전에는 패키지를 내려받으세요.

구현: `cmos-review-core.js`, `cmos-review-examples.js`, `cmos-review-ui.js`, `cmos-review.css`. 새 패키지 형식은 `waferflow-cmos-review-v1`이며 기존 웨이퍼 기록 형식과 별도입니다.


반도체 공정·장비 시뮬레이터. 메모리 Fab 통합, CMOS 단면 실험, 장비 운전실, 모델 근거 검증을 제공합니다. 공개 원리와 합성 모델을 사용하며 실제 팹 정확도나 장비 제어는 검증되지 않았습니다.

## CMOS AXIS · 장비 외관 및 전체 UI 개편 · 2026-09-28

장비 자체를 주 화면으로 사용하는 **WaferFlow AXIS** 작업대로 교체했습니다. 어두운 계측기 콘솔, 앰버색 제어부, 밝은 단면·실험 분석 화면과 별도로 여는 공정 경로를 사용합니다. CMOS 전용 스타일은 `cmos-console.css`에 있습니다.

- TEL·ASML·Lam Research·Applied Materials·KLA의 공개 장비 모습과 공식 구성을 참고해 **18종 산업 장비 외장**을 Blender로 제작했습니다. 전면 로드포트, 모듈 캐비닛, 서비스 구획, 점검창·HMI·상태등을 장비군에 맞춰 구성했습니다.
- **외관 / 내부 구조** 전환과 36개 도감 렌더, 1–4 키보드 시점, 현재 장비 PNG 저장, 장비별 공식 출처 및 단순화 범위를 제공합니다. 독자적으로 만든 원리 모형이며 제조사 CAD나 실측 검증 디지털 트윈은 아닙니다.
- 장비 파일의 길이·경계 및 HTTPS/localhost SHA-256 검사, 실패 시 기본 모형·다시 받기, WebGL 복구를 연결했습니다. 파일은 장비별로 필요할 때 로드하고 CPU 캐시는 4개로 제한합니다.
- 117단계 계산 모델 `wf-fab-0.6.0`, 레시피 초안·실험 기록, 관찰·단면·스윕·분기 비교를 유지합니다. 보기 변경은 완료 기록을 수정하지 않습니다.
- 키보드로 여닫는 공정 경로, 모바일 작업 영역, 지연 파일 읽기 중 입력 보존과 탭 간 저장 충돌을 실제 Chrome에서 검증했습니다.

[로컬 CMOS AXIS 열기](http://127.0.0.1:8770/cmos-lab.html) · [장비 재생성 방법](assets/cmos/README.md) · [검증 결과](QUALITY.md) · [상용 출시 범위와 남은 검증](CMOS_RELEASE_REVIEW.md)

교육·기업 데모용 구현과 공개 산출물을 갱신했습니다. 실측 보정·실장비 제어·제조 적용 검증과 온라인 배포는 포함하지 않습니다.

## 이전 Studio UI 리뉴얼 · 2026-09-28

메모리 팹과 CMOS 실습실에 같은 디자인 체계를 적용했습니다. 차콜 장비 화면, 아이보리 작업 영역, 민트 상태 표시를 사용하며 공유 스타일은 `studio.css`에 있습니다.

- 메모리 팹: 장비군별 그림이 있는 플로어 / 챔버 목록 전환, 선택 장비 강조, 선택한 재생 시점의 가공·대기·제외·편차 장비 수.
- CMOS: 3D 장비와 레시피 패널, 분리된 재생·관찰 도구, 공정 목록을 숨겨 화면을 넓히는 집중 보기. Esc로 기본 보기로 복귀합니다.
- 모바일: 접어서 여는 공정 목록과 좌우로 넘기는 LOT 지표. 보기 전환은 계산 기록·입력 초안을 바꾸지 않습니다.
- 외부 폰트·이미지 요청 없이 기존 장비 SVG와 3D 모형을 재사용합니다. 공정 계산 모델과 저장 형식은 유지합니다.

검증: JavaScript 504개, 두 화면의 5개 너비·새 보기 전환·재생 동작, 키보드/모션 감소, 공개 산출물 9페이지 확인. 상세 기록은 [QUALITY.md](QUALITY.md)에 있습니다.

## 2026-09-28 작업 재개

- 메모리 팹과 CMOS 실습실의 글자 크기·대비·입력 여백을 높이고 장비 지도, 단면, 결과 영역 바로가기를 추가했습니다. 모바일 장비 지도는 2열로 표시합니다.
- CMOS 공정을 전체·미완료·완료·경고 기록으로 필터링하고 검색어와 함께 좁힐 수 있습니다. 이전/다음 공정 버튼은 결과를 둘러보는 용도이며 실행 중에는 잠깁니다.
- 완료 공정 전후 조회는 같은 기록의 인접 계산 상태를 재사용합니다. 캐시는 32개로 제한하고, 기록 배열·웨이퍼가 바뀌면 서로의 결과를 재사용하지 않습니다.
- 폴리 폭은 각 Poly 층이 20 nm를 초과하는 위치만 포함한다는 기준을 명시합니다. 제외된 얇은 폴리 위치 수와 합산 두께를 별도 표시합니다. 구조 계산과 모델 버전 `wf-fab-0.6.0`은 유지합니다.
- 프로브 입력은 실제 계산에 맞춰 ‘구조 확인 지점 / sites’로 표기합니다. 장비 HTML 보고서의 긴 제목·프로필 ID는 인쇄 폭 안에서 줄바꿈합니다.
- 상세 검증 결과와 후속 작업은 [CHECKPOINT.md](CHECKPOINT.md), [QUALITY.md](QUALITY.md)에 기록합니다. 공개 사이트 배포는 별도입니다.

## 2026-09-24 개선

- CMOS 모델 `wf-fab-0.6.0`: 문헌에 근거한 NiSi 재료 소비·형성 비율, 후속 Si 소비에 따른 도핑 좌표, W 충전 기준 온도를 수정했습니다. [공정 모델 검토](docs/CMOS_MODEL_REVIEW_2026-09-24.md)에 근거와 계산 범위를 기록했습니다.
- 스페이서 증착 도중 막이 갑자기 증가하던 표시를 연속적으로 보간합니다. 기존 완료 구조와 117개 공정의 재생 결과는 유지하며, PECVD 설명은 수직 적층 계산과 실제 갭필 해석의 차이를 명시합니다.
- 깊은 식각이 입고 Si 표면 아래 600 nm 계산 영역을 소진하면 위치 수와 모델 한계를 안내합니다. 실제 식각 정지층으로 해석하지 않도록 미리보기·재생·기록·보고서에 표시합니다.
- 회전·입자를 관찰 시점에 맞춰 재현하고 가감속·반출 전 정렬을 연결했습니다. 멈춘 장면은 불필요한 GPU 렌더링을 쉬며, 메모리 팹 장비 모달도 같은 시간표를 사용합니다.
- CMOS 기록은 모델 버전별로 분리합니다. 이전 버전·손상 기록은 원본을 보존하고 복구 안내에서 내려받습니다. 다른 모델 버전의 결과를 같은 실험으로 몰래 재계산하지 않습니다.
- CMOS JSON을 읽는 동안 수정한 조건·빈칸·비교 범위·실험 메모를 보호합니다. 여러 파일을 선택하면 마지막 파일만 반영하고, 다른 작업을 시작했으면 다시 선택하도록 안내합니다.
- 자동 저장은 HTTPS 또는 localhost에서 브라우저의 탭 간 저장 잠금(Web Locks)을 사용합니다. 다른 탭이 먼저 저장하면 현재 탭의 자동 저장을 멈추므로 현재 실험을 JSON으로 보관한 뒤 새로고침하세요. 잠금 또는 저장소가 없는 환경에서도 계산과 JSON 내보내기는 사용할 수 있습니다.
- CMOS 개념·단위·첫 비교 실험 안내, 모바일 가독성과 키보드 조작을 보강했습니다. 외부 글꼴 요청을 없애 공개 자산만으로 화면을 표시합니다.
- 단면에서 Si 표면 아래의 조회 깊이를 바꾸며 활성 도핑 농도를 확인합니다. 이 조회는 공정 기록을 바꾸지 않으며, 모바일에서도 단위·농도와 조회 범위를 함께 표시합니다.
- 포토 실습은 정지한 시점부터 재개하고 화면을 떠나면 자동으로 멈춥니다. 메모리 팹은 손상 기록·동시 저장·저장 공간 부족을 구분해 안내하고 원본과 현재 계획의 별도 다운로드를 지원합니다.
- 포토 전체 기록 JSON을 다시 불러올 수 있습니다. 기존 기록의 다운로드를 시작한 뒤 교체하며, 실행 이력·레시피·가설·현재 조건·마지막 실행을 구분해 복원합니다.
- 장비 운전실은 실행 전 입력 초안을 운전 로그와 따로 보관합니다. 빈칸이나 작성 중인 숫자도 복원하며, 유효하지 않은 조건은 실행 전에 안내합니다. 초안 JSON으로 다른 브라우저에 옮길 수 있습니다.
- 서버에 연결한 계측 CSV는 원본 파일 바이트와 SHA-256을 보존해 다시 내려받을 수 있습니다. 붙여넣거나 편집한 텍스트는 별도로 표시하며, 원문이 없는 과거 기록에는 원본이 있다고 주장하지 않습니다.
- [제3자 자료·라이선스 고지](THIRD_PARTY_NOTICES.md)를 제공합니다. 자체 코드 배포 조건과 실측 정확도 검증은 별도 확인 사항입니다.

이 변경은 로컬 소스에 반영했습니다. 기존 온라인 사이트는 별도 배포 전까지 이전 버전일 수 있습니다.

## 설치 없이 웹에서 실행

[공개 실습실](https://waferflow-cmos-lab-jun.gombo123000.chatgpt.site) · [CMOS 제조 흐름 바로가기](https://waferflow-cmos-lab-jun.gombo123000.chatgpt.site/cmos-lab.html)

로그인이나 로컬 파일 없이 사용할 수 있습니다. 기록은 각 사용자 브라우저에 보관하며, 다른 기기로 옮길 때는 JSON으로 내보냅니다. 모델 근거 검증 자료는 새로고침 전에 검토 패키지를 내려받으세요. 서버 계정·공동 저장·승인 기능은 공개 버전에 포함하지 않습니다.

CMOS 실습에서 **주요 동작마다 멈춤**을 켜면 고정·회전·인계 지점에서 재생이 멈춥니다. **다음 동작까지 실행**으로 한 단계씩 관찰하거나 실행 버튼으로 재개할 수 있습니다. 일반 재생을 일시정지한 뒤에도 한 동작씩 진행할 수 있습니다. 노광·계측·프로브는 4개 대표 위치에서 정렬·처리 또는 접촉·해제를 따로 관찰합니다. 대표 위치 수는 계산 표본 수와 별개입니다.

구조·계측 탭에서는 선택 공정의 핵심 지표를 전후 값과 변화량으로 비교합니다. 완료 기록과 예상 결과를 구분하며, 여러 조건 비교 결과에는 계산 당시의 고정 조건과 입력 변경 여부가 표시됩니다.

`python build_public.py`는 명시적 공개 자산 목록으로 `.test-tools/site-source/dist`를 생성합니다. `.openai/hosting.json`은 기존 사이트를 가리키며, 공개 산출물에는 서버 코드·DB·사용자 기록을 넣지 않습니다. 로컬 빌드만으로 온라인 사이트가 갱신되지는 않습니다.

```powershell
python build_public.py
.\.venv-review\Scripts\python.exe tests/public_site.py
.\.venv-review\Scripts\python.exe tests/cmos_visual.py
.\.venv-review\Scripts\python.exe tests/cmos_observation.py
.\.venv-review\Scripts\python.exe tests/cmos_stage_observation.py
.\.venv-review\Scripts\python.exe tests/cmos_results.py
.\.venv-review\Scripts\python.exe tests/cmos_storage_browser.py
.\.venv-review\Scripts\python.exe tests/cmos_import_browser.py
.\.venv-review\Scripts\python.exe tests/cmos_limits_browser.py
.\.venv-review\Scripts\python.exe tests/memory_motion_browser.py
.\.venv-review\Scripts\python.exe tests/memory_storage_browser.py
.\.venv-review\Scripts\python.exe tests/photo_playback_browser.py
.\.venv-review\Scripts\python.exe tests/photo_machine_render_browser.py
.\.venv-review\Scripts\python.exe tests/photo_storage_browser.py
.\.venv-review\Scripts\python.exe tests/photo_import_browser.py
.\.venv-review\Scripts\python.exe tests/accessibility_browser.py
.\.venv-review\Scripts\python.exe tests/evidence_storage_browser.py
.\.venv-review\Scripts\python.exe tests/equipment_storage_browser.py
.\.venv-review\Scripts\python.exe tests/fab_pilot_import_browser.py
.\.venv-review\Scripts\python.exe tests/review_source_browser.py
# 실제 공개 주소 검사
.\.venv-review\Scripts\python.exe tests/public_site.py https://waferflow-cmos-lab-jun.gombo123000.chatgpt.site
```

## 현장 장비 데이터로 계산

[장비 데이터 연동 화면](https://waferflow-cmos-lab-jun.gombo123000.chatgpt.site/fab-data.html)에서 JSON/CSV 로그를 불러오고 태그를 매핑해 기준 조건과 비교합니다. 파일은 브라우저에서만 처리합니다. 현장 서버에서는 인증된 수집 API와 `tools/push_fab_data.py`로 로그를 받아 같은 화면으로 계산할 수 있습니다.

[현장 연동 계약·실행 방법·모델 범위](docs/FAB_DATA_INTEGRATION.md)를 먼저 확인하세요. SECS/GEM·EDA·OPC UA 직접 드라이버와 실측 보정은 아직 포함되지 않습니다. 실제 연결에는 제조사·통신 사양·태그 정의가 필요합니다.

```powershell
.\.venv-review\Scripts\python.exe -m unittest discover -s tests -p 'test_*.py'
.\.venv-review\Scripts\python.exe tests/fab_data_browser.py
```

## 다른 컴퓨터에서 실행

Windows / Python 3.12 이상. 기존 `.venv`가 다른 컴퓨터 경로를 가리키면 시작 스크립트가 `.venv-review`를 사용하거나 생성합니다. 설치된 의존성이 맞으면 인터넷에 다시 접속하지 않습니다. 아래 명령은 프로젝트 폴더에서 실행합니다. 처음 의존성을 설치할 때는 인터넷이 필요합니다. USB로 가져올 때 `.venv`는 제외하고 새 컴퓨터에서 다시 생성하세요.

```powershell
.\start-review.ps1 -Port 8770
```

PowerShell 스크립트 실행이 제한된 경우:

```powershell
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
.\.venv\Scripts\python.exe run_server.py --port 8770
```

접속: http://127.0.0.1:8770/ · 종료: 서버 터미널에서 `Ctrl+C`. 서버 코드 수정 후에는 같은 포트로 재시작합니다. 기본 실행은 localhost 전용입니다.

## 수정 위치

| 기능 | 주요 파일 |
|---|---|
| 메모리 Fab 통합 | `index.html`, `memory-fab.html`, `memory-fab-*.js`, `memory-fab.css` |
| CMOS 단면 실험 | `cmos-lab.html`, `fab-*.js`, `fab.css` |
| 장비 운전실 | `equipment.html`, `equipment-*.js`, `equipment.css` |
| 모델 근거 검증 | `evidence.html`, `evidence-*.js`, `evidence.css` |
| 서버 검토·저장 | `workbench.html`, `review.js`, `server/` |

`index.html`과 `memory-fab.html`은 동일하게 유지합니다. 새 화면·스크립트를 추가하면 `server/public-assets.json`에도 등록합니다. 검증 화면 404는 구버전 서버를 같은 포트로 재시작하면 해결됩니다. 현재 서버 버전은 `/api/status`에서 확인합니다.

## 검증 및 남은 작업

```powershell
node tests/run-all.mjs
.\.venv\Scripts\python.exe -m unittest discover -s tests -p "test_*.py"
.\.venv-review\Scripts\python.exe tests/run_review_ui.py
```

JavaScript 테스트는 Node.js 22 이상이 필요합니다. 검증 범위와 개선 내역은 [QUALITY.md](QUALITY.md)를 참고하세요. DOM·장면 그래프 검사에 더해 `tests/browser_smoke.py`로 실제 Chrome의 여섯 화면, 모바일 표시, 계획·CSV 다운로드, 모델 검증 흐름을 검사합니다. 실측 데이터 정확도와 현장 도입 적합성은 별도 검증이 필요합니다.

`tests/run_review_ui.py`는 전용 포트 8767과 임시 DB로 로그인·레시피·근거·동료 검토·내보내기 흐름을 검사합니다. 포트가 이미 사용 중이면 기존 서버에 테스트 데이터를 보내지 않고 중단합니다. 이 검사는 HTTP와 DOM 대상이며 브라우저 화면 배치 검사는 아닙니다.

## Git과 USB 보관 범위

- Git: 실행 코드, 설정·의존성, 테스트와 합성 fixture, 필수 라이선스, 이 인계서.
- USB/로컬: 상세 문서(`docs/`), 계측 파일, 내보낸 JSON·CSV·HTML, 백업. 데이터는 `data/`, `evidence-data/`, `exports/`에 두면 Git에서 제외됩니다.
- 브라우저 실험 기록은 프로젝트 폴더 복사로 이전되지 않습니다. 해당 화면에서 JSON으로 내보낸 뒤 새 컴퓨터에서 불러오세요.
- 서버 DB의 기본값은 `.data/waferflow.sqlite3`이며 `WF_DATABASE`로 바꿀 수 있습니다. 실행 중인 DB 파일 하나만 복사하지 말고 `server.backup`으로 별도 백업합니다. 다운로드한 빈 검증 템플릿은 실측 근거가 아닙니다.
- 백업 도구도 `WF_DATABASE`를 기본 원본으로 사용합니다. 다른 DB를 지정하려면 `--source`를 사용하며, 기존 파일에는 백업을 덮어쓰지 않습니다.

```powershell
.\.venv\Scripts\python.exe -m server.backup --output .data/backups/review-transfer.sqlite3
```

## 교육·검토 사용

메인 화면의 **실습 안내 · 검토 기록**을 열고 질문 → 가설 → 관찰 → 해석을 기록합니다. 기록은 브라우저에 저장되며 계획 JSON과 HTML 리포트에도 포함됩니다. 기존 계획 파일도 계속 불러올 수 있습니다.

- **공정 이력 CSV**: 전체 계획의 LOT·공정·챔버·대기·공정 후 구조 지표. 시간은 실제 분이 아닌 모형 분입니다.
- **규칙 편차 LOT**: 비교표·리포트에 완료 LOT과 별도로 표시합니다. 보류 해제 시 완료하더라도 규격 적합을 의미하지 않습니다.
- 교육 제출물: 가설·관찰을 작성한 계획 JSON + 변경 전후 HTML 리포트. 실무 검토 연습은 실측 데이터 검증 화면과 연결합니다.

실행 환경만 확인하려면 `.\start-review.ps1 -CheckOnly`를 실행합니다. 아래 명령은 복구 환경을 쓰는 경우입니다.

```powershell
.\.venv-review\Scripts\python.exe -m unittest discover -s tests -p "test_*.py"
# 선택: 실제 브라우저 검사 (설치된 Google Chrome 필요)
.\.venv-review\Scripts\python.exe -m pip install playwright
.\.venv-review\Scripts\python.exe tests/browser_smoke.py
# Node.js가 PATH에 없다면 Playwright에 포함된 Node 런타임으로 검사 가능
& .\.venv-review\Lib\site-packages\playwright\driver\node.exe tests/run-all.mjs
```

브라우저 검사는 사용자 DB 대신 임시 DB를 만들며 화면과 결과를 `.test-tools/`에 보관합니다. 이 폴더와 가상환경은 Git에 포함하지 않습니다.


### 현장 파일럿 검토

`fab-pilot.html`에서 장비·챔버·제품·레시피 개정별 프로파일을 고정하고 최대 100건을 재계산합니다. 계측 대조, 독립된 기준 잔차 감시, 입력 해시와 재현 패키지를 지원합니다. 합성 예제는 `examples/fab-pilot-profile.json`, `examples/fab-pilot-batch.json`에 있습니다. 파일 묶음 준비는 `tools/prepare_pilot_batch.py`, 현장 운영 절차는 `docs/FAB_PILOT_RUNBOOK.md`를 참고하세요. 실제 장비 제어와 양산 승인은 포함하지 않습니다.

CMOS 실습실은 일시정지 중 관찰 시점 이동, 공정 전 표면 겹치기, 위치별 재료 증가/감소와 선택 위치 전후 두께 비교를 제공합니다. 사용과 계산 범위는 `docs/CMOS_OBSERVATION.md`를 참고하세요.
