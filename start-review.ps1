param(
    [ValidateRange(1, 65535)]
    [int]$Port = 8766
)

$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath $PSScriptRoot
if (-not (Test-Path -LiteralPath '.venv\Scripts\python.exe')) {
    python -m venv .venv
    if ($LASTEXITCODE -ne 0) { throw 'Python 가상 환경을 만들지 못했습니다.' }
}
& '.\.venv\Scripts\python.exe' -m pip install -r requirements.txt
if ($LASTEXITCODE -ne 0) { throw '의존성을 설치하지 못했습니다.' }
& '.\.venv\Scripts\python.exe' run_server.py --port $Port
if ($LASTEXITCODE -ne 0) { throw "서버 실행에 실패했습니다. $Port 포트에서 이전 서버가 실행 중인지 확인하세요." }
