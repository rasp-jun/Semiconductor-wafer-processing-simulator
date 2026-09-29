# STRATUM · 교육·기업 데모 릴리스 검토

갱신: 2026-09-29 · STRATUM UI / 장비 edition 03 · 계산 모델 `wf-fab-0.6.0`

제품 이름과 공통 작업 화면을 STRATUM으로 갱신했습니다. 최신 출시 준비 항목은 [STRATUM_RELEASE.md](STRATUM_RELEASE.md), 회귀 검증 기록은 [QUALITY.md](QUALITY.md)에 정리합니다.

이번 구현의 대상은 CMOS 교육·기업 데모 제품입니다. 실장비 제어, 양산 레시피 검증, 실측 정확도 보증을 제공하는 제조용 제품으로 검증한 상태는 아닙니다.

## 구현한 제품 범위

- **실험 검토실**: 현재 작업의 동일 완료 공정 비교와 산화·식각·CMP 독립 예제. 위치별 표면 비교·차이 그래프, 정확한 완료 레시피 차이, 경고·메모를 검토합니다. JSON 패키지와 자체 포함 HTML 보고서를 제공하며, 가져올 때 체크섬·모델 버전·양쪽 모든 공정의 결과를 다시 확인합니다. 체크섬은 출처 인증이나 승인 서명이 아닙니다.

- **AXIS 작업대**: 장비를 크게 표시하는 콘솔, 별도로 여는 117단계 공정 경로, 8개 모듈 이동, 레시피 입력, 밝은 단면·실험 분석 화면, 공통 실행·정지·취소 바.
- **18종 장비 edition 03**: 공통 전면 외장을 18개 독립 구조로 교체. 수직 타워·방사형 클러스터·빔라인·적층 트랙·연마 캐러셀·계측 프레임과 테스트 헤드를 구분하고 내부 보조 기구·장비별 기본 시점·외형 특징 검색을 추가. 산업 장비의 외장·전면 반송부·서비스 구획을 반영한 Blender 원본. 외관/내부를 별도로 표시하고 36개 도감 렌더, 카메라 자동 맞춤, 장비별 참고 자료를 제공.
- **관찰·내보내기**: 키보드 1–4 시점 전환, 관찰 시점 이동, 공정 전후 구조, 파라미터 스윕·실험 분기 비교, 3D PNG와 기존 JSON/CSV/HTML 기록 내보내기.
- **외관 공정 실행**: 내부 구조 체크 상태를 시작·재개·한 동작·연속 실행에서 유지. 전체 장비 본 화면에서 장비별 로드포트를 따라 이동하는 웨이퍼·포크와 반투명 추적 렌즈 ×1.6를 표시. 실제 재료·회전·공정 시간과 가공면 확대를 공유하며 단계별 진행·상태등·창 안의 기구 동작을 연결. 추적 렌즈와 진행 도해는 PNG에도 포함하고 좁은 화면에서 장비·진행·가공면 영역을 분리.
- **복구**: 모델 크기·버퍼 경계 검사, HTTPS/localhost의 SHA-256 검사, 실패 시 기본 모형과 재시도, WebGL 연결 복구, WebGL 없는 환경에서도 계산·단면 유지.
- **기록 보존**: 모델 버전별 기록 격리, 기존 기록 원본 다운로드, 탭 간 동시 저장 충돌 방지, 파일을 읽는 동안 수정한 조건·메모 보호. 화면 변경과 완료 기록을 분리.

## 장비 참고 근거

공개 사진에서 외장의 비례·구획·반송부를 살펴보고, 공식 설명으로 장비군의 역할과 구성을 확인했습니다. 외장·내부 모델과 렌더는 프로젝트 코드로 제작했으며 제조사 사진·로고·CAD를 공개 산출물에 복제하지 않았습니다. 실제 치수나 내부 배치가 공개되어 확인된 것으로 표현하지 않습니다. 개별 장비의 **참고 장비** 창에서도 같은 범위를 확인할 수 있습니다.

| 장비군 | 공식 참고 자료 | 반영한 구성 |
|---|---|---|
| 세정·습식 식각 | [TEL EXPEDIUS](https://www.tel.com/product/expedius.html) | 약액 처리 구획, 전면 반송부, 서비스 구획 |
| 산화·LPCVD | [TEL TELINDY](https://www.tel.com/product/telindy.html) | 수직 반응관 외장과 하부 보트 승강부 |
| 도포·현상·베이크 | [TEL CLEAN TRACK LITHIUS](https://www.tel.com/product/lithius.html) | 적층 모듈과 반송 통로를 갖는 트랙 |
| 노광 | [ASML DUV](https://www.asml.com/en/products/duv-lithography-systems) | 대형 광학계 외장, 반송·서비스 모듈 |
| 식각·박리 | [Lam Kiyo](https://www.lamresearch.com/product/kiyo-product-family/), [GAMMA](https://www.lamresearch.com/product/gamma-product-family/) | 클러스터 챔버와 RF 서비스 구획 |
| PECVD·ALD | [Lam VECTOR](https://www.lamresearch.com/product/vector-product-family/), [Striker](https://www.lamresearch.com/product/striker-product-family/) | 다중 처리 모듈, 반송부와 전구체 공급 구획 |
| 이온 주입 | [Applied Materials VIISta 900 3D](https://www.appliedmaterials.com/us/en/product-library/viista-900-3d.html) | 이온원–빔라인–처리부를 잇는 긴 구획 |
| CMP | [Applied Materials Reflexion LK](https://www.appliedmaterials.com/us/en/product-library/reflexion-lk-cmp.html) | 연마·후세정·건조 구획 |
| PVD·RTP | [Applied Materials Endura 계열](https://www.appliedmaterials.com/us/en/product-library/cobalt-product-suite.html), [Radiance RTP](https://ir.appliedmaterials.com/news-releases/news-release-details/applied-materials-takes-rtp-technology-next-level-new-radiance) | 진공 클러스터, 가열부·서비스 구획 |
| 계측·프로브 | [KLA 계측](https://www.spts.com/products/chip-manufacturing/metrology), [TEL Prexa](https://www.tel.com/product/prexa.html) | 광학/프로브 외장, 정밀 스테이지와 테스트 전자부 |

## 검증과 전달

실제 실행한 검증과 결과는 [QUALITY.md](QUALITY.md)의 AXIS 항목에 있습니다. 공개 빌드에는 허용 목록의 정적 자산만 포함하고 사용자 DB·Blender 소스·로컬 참고 사진은 넣지 않습니다. 로컬 서버는 `http://127.0.0.1:8770/cmos-lab.html`, 재생성한 배포 폴더는 `.test-tools/site-source/dist/`입니다. 이번 작업에서 온라인 사이트를 배포하지 않았습니다.

## 유료 출시 전에 남은 검증

| 항목 | 현재 상태 | 완료 근거 |
|---|---|---|
| 교육·데모 사용자 검증 | 로컬 Chrome 기능·화면 검사 완료 | 대상 사용자 과제 수행·가독성·학습 효과 평가 |
| 지원 환경 | Windows Chrome에서 검증 | 실제 지원할 Safari/Firefox·태블릿·저사양 GPU의 성능 및 복구 기록 |
| 공정 정확도 | 공개 원리를 축약한 미보정 구조 모델 | 실측 웨이퍼 데이터, 장비별 보정, 오차 허용 기준과 독립 검증 |
| 실제 치수·동작 | 원리 관찰용 자체 모델 | 제공받은 치수·설비 도면·이송 사양과 대조 |
| 운영 | 로컬·정적 공개 빌드 준비 | 배포·롤백·지원 절차와 서비스 운영 환경 검증 |
| 자체 제품 이용 조건 | 제3자 고지는 보존, 자체 LICENSE 미정 | 프로젝트 권리자의 배포 조건 결정 |

외관 품질 개선과 위 소프트웨어 검증만으로 제조사 인증이나 제조 현장 적용 검증을 대신하지 않습니다.
