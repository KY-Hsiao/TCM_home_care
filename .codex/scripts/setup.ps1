$ErrorActionPreference = "Stop"

$workspace = Split-Path -Parent $PSScriptRoot
$projectRoot = Split-Path -Parent $workspace
$venvDir = Join-Path $projectRoot ".venv"
$venvPython = Join-Path $venvDir "Scripts\python.exe"
$requirementsFile = Join-Path $projectRoot "requirements.txt"
$preferredPython = "3.13"

foreach ($proxyVar in @("HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY", "GIT_HTTP_PROXY", "GIT_HTTPS_PROXY")) {
    Remove-Item "Env:$proxyVar" -ErrorAction SilentlyContinue
}

if (-not (Test-Path -LiteralPath $requirementsFile)) {
    throw "requirements.txt was not found, so setup cannot continue."
}

try {
    $null = py -$preferredPython --version
} catch {
    throw "Python $preferredPython is not available, so the virtual environment cannot be created."
}

if (-not (Test-Path -LiteralPath $venvPython)) {
    Write-Host "Creating Python $preferredPython virtual environment .venv ..."
    py -$preferredPython -m venv $venvDir
}

Write-Host "Installing requirements.txt dependencies ..."
& $venvPython -m pip install -r $requirementsFile

if ($LASTEXITCODE -ne 0) {
    throw "Dependency installation failed. Check requirements.txt or network access."
}

Write-Host "Project setup completed."
