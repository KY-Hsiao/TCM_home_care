param(
    [string]$Host = "127.0.0.1",
    [int]$Port = 8765
)

$ErrorActionPreference = "Stop"
$scriptRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$pythonLauncher = Get-Command py -ErrorAction SilentlyContinue

if ($pythonLauncher) {
    & $pythonLauncher.Source -3 (Join-Path $scriptRoot "line_helper_server.py") --host $Host --port $Port
    exit $LASTEXITCODE
}

$pythonCommand = Get-Command python -ErrorAction SilentlyContinue
if (-not $pythonCommand) {
    throw "找不到 Python，無法啟動 LINE helper。"
}

& $pythonCommand.Source (Join-Path $scriptRoot "line_helper_server.py") --host $Host --port $Port
exit $LASTEXITCODE
