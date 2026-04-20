$projectRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$venvPath = Join-Path $projectRoot ".venv"
$pythonExe = Join-Path $venvPath "Scripts\python.exe"
$appPath = Join-Path $projectRoot "app.py"

if (-not (Test-Path $pythonExe)) {
    py -3.13 -m venv $venvPath
}

& $pythonExe $appPath
