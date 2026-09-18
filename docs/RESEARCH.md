# 공개 조사 노트

조사 기준: 2026-09-18. 공식 제품 문서, 제조사·대학 공정 자료, 공개 PDK, 공개 특허 문헌을 확인했습니다. 전 세계 제품·특허·비공개 제조 IP를 전수 조사한 결과는 아닙니다.

실장비 사전 검증으로 확장하기 위한 삼성·SK하이닉스 공개 자료, PHM 2018·SECOM 후보의 출처·단위·이용 조건·확보 상태는 [실장비 데이터 조사](EQUIPMENT-DATA.md)에 별도로 정리했습니다.

## 상용 제품과 교육 도구

| 제품 | 공개된 방향 | 이 프로젝트에 주는 시사점 | 1차 출처 |
|---|---|---|---|
| Synopsys Sentaurus Process | 산화·확산·이온주입 등 1D/2D/3D 공정 수치 모델 | 물리 정확도를 경쟁하려면 검증 데이터와 수치 해석이 필요 | [공정 시뮬레이션](https://www.synopsys.com/manufacturing/tcad/process-simulation.html) |
| Silvaco Victory Process | 레이아웃 기반 2D/3D 공정 모델링 | 제조성·구조 변화는 이미 상용화된 범주 | [Victory Process](https://silvaco.com/tcad/victory-process-3d/) |
| Lam SEMulator3D | 3D 가상 제조, 공정창·구조·수율 분석 | 3D 장면 자체를 신규성의 근거로 삼기 어려움 | [제품 소개](https://www.lamresearch.com/product/semulator3d/) |
| COMSOL Plasma Module | 플라즈마·수송·표면 반응 모델 | RF·압력 효과는 장비·화학종에 따라 달라짐 | [Plasma Module](https://www.comsol.com/plasma-module) |
| ASML Computational Lithography | 장비와 시험 웨이퍼로 보정한 패터닝 모델 | 실제 예측력의 핵심은 보정 데이터와 검증 | [Computational Lithography](https://www.asml.com/en/products/computational-lithography) |
| KLA PROLITH | 광학·재료·패터닝 시뮬레이션 | 포토 공정 시뮬레이션은 기존 전문 분야 | [KLA 소프트웨어 솔루션](https://www.spts.com/products/software-solutions/semiconductor) |
| Purdue vFabLab | 온라인 가상 클린룸·장비 교육 | 가상 실습 역시 기존 제품과 비교해야 함 | [Purdue 소개](https://engineering.purdue.edu/Engr/AboutUs/News/Spotlights/2023/2023-1113-vfablab) |

공개 소개의 범위만 비교했습니다. 라이선스 가격, 설치 난이도, 성능, 국내 점유율, 취업 효과는 검증하지 않았으며 숫자로 만들지 않았습니다.

**제품 가설:** 한국어 포토 공정의 장면·단면·불량 원인 단서와 실험 가설을 같은 화면에서 연결하고, 재현 가능한 취업 포트폴리오 기록으로 만드는 경험. ‘시장에 없다’는 사실이 아니라 사용자 검증이 필요한 차별화 가설입니다.

## 포토 공정과 인접 공정의 근거

장비실 설계에는 코터/디벨로퍼와 광학 노광 장비가 서로 다른 역할을 수행한다는 제조사 공개 설명을 참고했습니다. [Tokyo Electron 제품군](https://www.tel.com/product/all/)은 coater/developer를 별도 제품으로 소개하고, [SUSS의 마스크 정렬 장비](https://www.suss.com/de/produkte-loesungen/bildgebungsloesungen/maskenjustage?languageChanged=de)는 마스크 정렬과 노광 광학계의 역할을 설명합니다. 장비 형상은 독립 제작했으며 특정 모델의 기능·치수·배관·레시피를 재현하지 않았습니다.

3D 렌더링은 [Three.js WebGLRenderer](https://threejs.org/docs/pages/WebGLRenderer.html)를 사용합니다. 번들 버전은 재현성을 위해 0.180.0으로 고정했고 라이선스를 `vendor/THREE-LICENSE`에 포함했습니다. 카메라 회전·확대 제어는 직접 작성했습니다.

| 주제 | 참고한 원리 | 출처 |
|---|---|---|
| 포토 공정 순서 | 준비·도포·soft bake·노광·PEB·현상 | [BYU Cleanroom](https://www.cleanroom.byu.edu/SOP_05PR) |
| 노광·베이크·현상과 불량 | 재료·조건별 현상 및 잔사 등의 원인 | [MicroChemicals 응용 자료](https://www.microchemicals.com/DOWNLOADS/Application-Notes/), [Trouble Shooter PDF](https://www.microchemicals.com/dokumente/application_notes/lithography_trouble_shooting.pdf) |
| 광학 해상도 | 파장·NA와 해상도의 관계 | [ASML Lenses and mirrors](https://www.asml.com/en/technology/lithography-principles/lenses-and-mirrors) |
| 산화 성장 | Deal–Grove의 성장 관계 | [MIT OCW](https://ocw.mit.edu/courses/6-774-physics-of-microfabrication-front-end-processing-fall-2004/resources/mit6_774f04_lec06_mp4/) |
| 전체 제조의 복잡성 | 여러 단위 공정을 반복하는 제조 흐름 | [ASML How microchips are made](https://www.asml.com/en/technology/all-about-microchips/how-microchips-are-made) |

실제 포토 공정에는 탈수·프라이밍/HMDS, edge bead removal, 냉각·대기, 정렬, 검사 등이 추가될 수 있습니다. 감광액에 따라 PEB의 필요 여부와 기능이 달라집니다. 이번 앱은 이 전체를 재현하지 않으며, 음성 PR·EUV·OPC·멀티패터닝도 구현하지 않았습니다.

## 공개 PDK / 반도체 IP

1. **SKY130:** 설계 규칙, 레이어, 소자 모델과 관련 리소스를 공개한 PDK입니다. [공식 저장소](https://github.com/google/skywater-pdk), [설계 규칙](https://skywater-pdk.readthedocs.io/en/main/rules.html).
2. **GF180MCU:** GlobalFoundries의 180 nm MCU 공정을 위한 공개 PDK 리소스입니다. [공식 저장소](https://github.com/google/gf180mcu-pdk).
3. **공개 특허 검색 예시:** 포토리소그래피 컴퓨터 시뮬레이션에 관한 [US8165854B1](https://patents.google.com/patent/US8165854B1/en), [US7941768B1](https://patents.google.com/patent/US7941768B1/en)을 확인했습니다. 공개 문헌의 존재와 주제만 조사했으며, 법적 상태·권리 범위·실시 가능성·비침해 여부는 판단하지 않았습니다.

PDK, 설계 IP 코어, 장비 레시피, 특허는 서로 다른 범주입니다. 공개 PDK를 읽었다고 특정 파운드리의 제조 레시피나 공정 노하우가 확보되는 것은 아닙니다. 이번 앱에는 PDK 파일이나 특허 구현 코드를 가져오지 않았습니다. 원본 코드와 SVG는 독립적으로 작성했습니다. 공개 리소스의 실제 도입 시에는 각 저장소의 정확한 버전·라이선스·재배포 조건을 기록해야 합니다.

## 실측 데이터 후보와 합성 통계의 구분

WM-811K는 웨이퍼 불량 맵 분석용 공개 연구 데이터 후보입니다. [ICCAD 2021 연구 논문](https://www.cse.cuhk.edu.hk/~byu/papers/C126-ICCAD2021-Wafer.pdf)은 811,457개 이미지, 46,293개 lot, 172,950개 전문가 라벨을 설명합니다. 이 수치는 해당 데이터셋의 설명이며 반도체 시장 전체의 불량 통계가 아닙니다.

현재 앱은 이 데이터셋을 다운로드·학습·집계하지 않았습니다. 웨이퍼 맵만으로 온도·노광량·장비 조건과 실제 수율의 인과 관계를 보정했다고 주장할 수도 없습니다. 사용 시 원 배포처, 이용 조건, 중복·lot 단위 분리, train/test 누출을 먼저 확인해야 합니다.

현재 생성한 통계는 다음으로 한정합니다.

- 모델 내 528개 다이의 정상/불량 수와 유형 집계
- 다이별 식각 깊이 8구간 히스토그램
- 입력 변수 하나를 9개 값으로 바꾼 수율·가상 비용
- 고정 레시피에서 시드만 바꾼 30개 합성 웨이퍼의 수율 분포

자세한 계산식은 [MODEL.md](MODEL.md)에, 실제 생성 예시는 `docs/sample-statistics.json`에 있습니다.
