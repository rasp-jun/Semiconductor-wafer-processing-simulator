param(
    [ValidateRange(1, 65535)]
    [int]$Port = 8770,
    [switch]$CheckOnly
)
$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath $PSScriptRoot
function Test-ProjectPython([string]$Executable) {
    if (-not (Test-Path -LiteralPath $Executable)) { return $false }
    try {
        & $Executable -c "import sys; sys.exit(0 if sys.version_info >= (3,12) else 1)" 2>$null
        return $LASTEXITCODE -eq 0
    } catch { return $false }
}
$ProjectPython = '.\.venv\Scripts\python.exe'
if (-not (Test-ProjectPython $ProjectPython)) {
    $ProjectPython = '.\.venv-review\Scripts\python.exe'
    if (-not (Test-ProjectPython $ProjectPython)) {
        if (Test-ProjectPython '.\.test-tools\runtime\Scripts\python.exe') {
            $ProjectPython = '.\.test-tools\runtime\Scripts\python.exe'
        } else {
        python -c "import sys; sys.exit(0 if sys.version_info >= (3,12) else 1)"
        if ($LASTEXITCODE -ne 0) { throw 'Python 3.12 이상을 설치하고 터미널을 다시 여세요.' }
        python -m venv .venv-review
        if ($LASTEXITCODE -ne 0) { throw '새 Python 가상환경을 만들지 못했습니다.' }
        }
    }
    Write-Host "이 컴퓨터에서 실행 가능한 $ProjectPython 환경을 사용합니다. 기존 .venv는 보존합니다."
}
$DependencyCheck = "from importlib.metadata import version; from pathlib import Path; import sys; pairs=[line.split('==',1) for line in Path('requirements.txt').read_text().splitlines() if line.strip() and not line.startswith('#')]; sys.exit(0 if all(version(name)==expected for name,expected in pairs) else 1)"
try { & $ProjectPython -c $DependencyCheck 2>$null; $DependenciesReady = $LASTEXITCODE -eq 0 } catch { $DependenciesReady = $false }
if (-not $DependenciesReady) {
    & $ProjectPython -m pip install -r requirements.txt
    if ($LASTEXITCODE -ne 0) { throw '의존성을 설치하지 못했습니다. 인터넷 연결을 확인하세요.' }
}
if ($CheckOnly) {
    & $ProjectPython -c "import flask, waitress; print('WaferFlow: Python and server dependencies OK')"
    if ($LASTEXITCODE -ne 0) { throw '서버 의존성을 불러오지 못했습니다.' }
    return
}
& $ProjectPython run_server.py --port $Port
if ($LASTEXITCODE -ne 0) { throw "서버 실행에 실패했습니다. $Port 포트에서 이전 서버가 실행 중인지 확인하세요." }
