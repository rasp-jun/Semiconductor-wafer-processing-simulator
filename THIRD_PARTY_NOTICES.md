# WaferFlow 제3자 자료 및 라이선스 고지

확인일: 2026-09-24. 이 문서는 저장소와 설치된 패키지에서 확인한 외부 자료의 고지입니다. WaferFlow 자체 코드의 저작권자를 정하거나 프로젝트 전체에 새로운 라이선스를 부여하지 않습니다.

## 브라우저 배포에 포함된 라이브러리

| 구성 요소 | 확인한 파일 · 버전 | 라이선스 · 원문 |
|---|---|---|
| Three.js | `vendor/three.js`, REVISION `180` | MIT, [동봉된 저작권·허락·면책 고지](vendor/THREE-LICENSE), [공식 프로젝트](https://github.com/mrdoob/three.js) |

Three.js는 상업적 사용·수정·재배포를 허용하며, 사본이나 상당한 부분을 배포할 때 위 저작권 및 허락 고지를 함께 보존해야 합니다. 공개 정적 자산 목록에는 `vendor/THREE-LICENSE`가 포함되어 있습니다. 원문이 조건의 기준입니다.

## 공개 실장비 데이터와 파생 자료

`public-data/spts-study.json`에는 다음 자료에서 계산한 부분집합·통계·회귀 모델과 축약 시계열이 포함됩니다.

- 저자: Mudassir Ali Sayyed, Tom Seifert, Stephan Zieger, Simeon Schwarzenberg, Aditya Deshmukh, Micha Haase, Jan Langer.
- 원자료: *A Multi-Model Dataset for BOSCH Plasma-Etching: Optical Emission Spectra, Process Parameters, and Wafer Measurements for Data-Driven Plasma Modeling*, version v1, 2025-09-15, Zenodo.
- 출처: [Zenodo 데이터셋](https://zenodo.org/records/17122442), DOI [10.5281/zenodo.17122442](https://doi.org/10.5281/zenodo.17122442).
- 라이선스: [Creative Commons Attribution 4.0 International (CC BY 4.0)](https://creativecommons.org/licenses/by/4.0/), [법적 조건 원문](https://creativecommons.org/licenses/by/4.0/legalcode). Zenodo API의 `metadata.license.id = cc-by-4.0`을 확인했습니다.
- 사용한 파일: `Process_data.nc`, `Dictionary_process.nc`, `Si_Oxide_etch_9_points.csv`, `Readme.pdf`. 파일별 원본 MD5와 로컬 SHA-256은 파생 JSON의 `source.files`에 있습니다.
- 변경 내용: 96개 운전 그룹 중 9점 계측을 연결할 수 있는 75개 운전을 선정했습니다. 9개 채널의 통계 특성을 추출하고, 날짜로 학습·검증을 나누어 ridge 회귀 결과를 추가했습니다. 화면의 시계열은 원본 시점 중 최대 81개로 축약했습니다. 재현 스크립트는 `tools/build_public_study.py`입니다.

CC BY 4.0은 상업적 이용과 변경을 허용합니다. 원저자·출처·라이선스 링크·변경 사실을 합리적인 방식으로 표시하고, 허가된 이용을 제한하는 추가 조건을 부과하지 않아야 합니다. 원저자·기관·장비 업체가 WaferFlow 또는 파생 모델을 보증한다는 의미는 없습니다. 이 데이터는 BOSCH 식각 연구용이며 CMOS 기준 공정의 보정 데이터가 아닙니다.

## 선택적 서버 의존성

다음은 `requirements.txt`와 `.venv-review`에 실제 설치된 배포 메타데이터 및 라이선스 파일을 대조한 결과입니다. 이 패키지들은 공개 브라우저 전용 자산에 포함되지 않습니다.

| 패키지 | 고정 버전 | 확인한 라이선스 |
|---|---|---|
| blinker | 1.9.0 | MIT |
| click | 8.5.0 | BSD-3-Clause |
| Flask | 3.1.3 | BSD-3-Clause |
| itsdangerous | 2.2.0 | BSD-3-Clause |
| Jinja2 | 3.1.6 | BSD-3-Clause |
| MarkupSafe | 3.0.3 | BSD-3-Clause |
| waitress | 3.0.2 | Zope Public License 2.1 |
| Werkzeug | 3.1.8 | BSD-3-Clause |

서버 패키지·컨테이너·가상환경을 재배포할 때 각 패키지의 `*.dist-info` 안에 있는 LICENSE 파일 및 저작권 고지를 보존하세요. Werkzeug에는 별도로 `werkzeug/debug/shared/ICON_LICENSE.md`의 Mark James, Silk icon set 1.3 고지(CC BY 2.5 또는 CC BY 3.0 선택)가 있습니다. 이 문서의 표가 해당 원문을 대체하지 않습니다. Python 런타임이나 다른 도구를 함께 묶으면 그 구성 요소도 별도 확인 대상입니다.

## 테스트와 재현 도구

- `tests/linkedom.worker.mjs`는 공식 npm `linkedom@0.18.12`의 `worker.js`와 줄바꿈 정규화 후 일치합니다. 로컬 파일 SHA-256: `196efeb17c260e001979dbc54a3c30e701a881c6e8a3eedaddc5ad83c99ee5ff`.
- linkedom 본체는 ISC이며 `tests/LINKEDOM-LICENSE`를 보존합니다. 공식 릴리스 커밋의 package-lock과 Rollup 설정으로 재빌드한 결과가 현재 worker와 일치함을 확인했습니다. 번들에 실제 포함된 16개 고지 단위의 라이선스 원문은 `tests/LINKEDOM-THIRD-PARTY-NOTICES.md`, 버전·원본 출처·integrity·해시·포함 모듈은 `tests/LINKEDOM-PROVENANCE.json`에 보존했습니다. 두 entities 버전, 생성된 CommonJS 실행 보조 코드, css-select가 포함한 XRegExp 코드 고지까지 포함합니다. 테스트 번들이 있는 소스 배포에는 이 세 고지/근거 파일도 함께 포함하세요. 공개 정적 사이트는 테스트 번들을 배포하지 않습니다.
- Playwright·Chrome·Node·NumPy·netCDF4 등 로컬 검증/재현 도구는 공개 정적 자산에 포함되지 않습니다. 이 도구 및 네이티브 의존성을 별도 설치 패키지에 묶어 배포할 경우 해당 배포물의 라이선스·고지도 포함해야 합니다.

## 글꼴·이미지·참고 링크

CMOS 화면은 설치된 시스템 글꼴을 사용하며 글꼴 파일을 배포하지 않습니다. 포토 화면의 외부 Google Fonts 링크도 제거되어 공개 자산에서 외부 글꼴 요청을 사용하지 않습니다. 공개 자산 목록에서는 외부 업체의 이미지·CAD·폰트 파일을 확인하지 못했습니다. 장비는 코드로 만든 관찰용 도형입니다. 이는 저장소 밖 자료나 모든 과거 기여분의 권리관계까지 확인한 결과는 아닙니다.

ASML·Lam Research·Applied Materials·KLA·FormFactor·MicroChemicals·SkyWater 및 대학 자료 링크는 원리 설명을 위한 참고 출처입니다. 해당 페이지의 사진·문서·상표·PDK가 이 프로젝트의 라이선스로 재배포된다는 뜻은 아닙니다. 제3자의 사진·도면·코드를 새로 포함하면 그 자료의 실제 허락 조건을 별도로 기록해야 합니다.

## 프로젝트 자체의 이용 조건

### AXIS 장비 모형 · 2026-09-28

18종 CMOS 장비의 산업용 외장·반송부·서비스 구획은 공개 사진과 제조사의 제품 설명을 참고해 Blender Python으로 자체 제작했습니다. 공개 배포물의 장비 이미지 36개는 해당 자체 모델의 렌더이며 제조사 사진·상표·CAD를 복제한 파일이 아닙니다. 참고한 공식 자료와 모델의 표현 범위는 `cmos-equipment-catalog.js`, 장비별 **참고 장비** 창, [릴리스 검토](CMOS_RELEASE_REVIEW.md)에 기록했습니다. 실제 장비와의 치수 일치, 내부 배치의 정확성 또는 제조사의 보증을 주장하지 않습니다.

### 자체 코드

이 저장소에는 WaferFlow 자체 코드 전체를 대상으로 한 명시적인 LICENSE 파일이 없습니다. 상업용 제품이나 교육 서비스 배포 시 프로젝트 권리자가 자체 코드·기여분의 권리관계를 확인하고 배포 조건을 정해야 합니다. 외부 라이브러리의 MIT 또는 공개 데이터의 CC BY 조건을 프로젝트 전체의 허락으로 확장하지 않습니다. 이 고지는 실제 장비 정확도·교육 인증·양산 적합성에 대한 보증도 아닙니다.
