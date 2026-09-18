# WaferFlow — 개발 인계

반도체 공정·장비 시뮬레이터. 메모리 Fab 통합, CMOS 단면 실험, 장비 운전실, 모델 근거 검증을 제공합니다. 공개 원리와 합성 모델을 사용하며 실제 팹 정확도나 장비 제어는 검증되지 않았습니다.

## 다른 컴퓨터에서 실행

Windows / Python 3.12 이상. 아래 명령은 프로젝트 폴더에서 실행합니다. 처음 의존성을 설치할 때는 인터넷이 필요합니다. USB로 가져올 때 `.venv`는 제외하고 새 컴퓨터에서 다시 생성하세요.

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
```

JavaScript 테스트는 Node.js 22 이상이 필요합니다. 최근 검증: JavaScript 258개 + Python 39개 통과. 화면 테스트는 DOM·장면 그래프 기반이며 실제 브라우저/GPU 시각 확인과 실측 데이터 정확도 검증은 남아 있습니다.

## Git과 USB 보관 범위

- Git: 실행 코드, 설정·의존성, 테스트와 합성 fixture, 필수 라이선스, 이 인계서.
- USB/로컬: 상세 문서(`docs/`), 계측 파일, 내보낸 JSON·CSV·HTML, 백업. 데이터는 `data/`, `evidence-data/`, `exports/`에 두면 Git에서 제외됩니다.
- 브라우저 실험 기록은 프로젝트 폴더 복사로 이전되지 않습니다. 해당 화면에서 JSON으로 내보낸 뒤 새 컴퓨터에서 불러오세요.
- 서버 DB는 `.data/waferflow.sqlite3`입니다. 실행 중인 DB 파일 하나만 복사하지 말고 `server.backup`으로 별도 백업합니다. 다운로드한 빈 검증 템플릿은 실측 근거가 아닙니다.

```powershell
.\.venv\Scripts\python.exe -m server.backup --output .data/backups/review-transfer.sqlite3
```
