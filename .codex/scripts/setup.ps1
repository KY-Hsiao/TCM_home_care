$ErrorActionPreference = "Stop"

$workspace = Split-Path -Parent $PSScriptRoot
$projectRoot = Split-Path -Parent $workspace
$venvDir = Join-Path $projectRoot ".venv"
$venvPython = Join-Path $venvDir "Scripts\python.exe"
$requirementsFile = Join-Path $projectRoot "requirements.txt"
$preferredPython = "3.13"
$localDepsRoot = "C:\codex-deps\tcm-home-care"
$verifyRoot = "C:\codex-deps\tcm-home-care-verify"
$packageManifestFiles = @("package.json", "package-lock.json", ".npmrc")

foreach ($proxyVar in @("HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY", "GIT_HTTP_PROXY", "GIT_HTTPS_PROXY")) {
    Remove-Item "Env:$proxyVar" -ErrorAction SilentlyContinue
}

function Test-UsableNodeModules {
    param(
        [Parameter(Mandatory = $true)]
        [string]$RootPath
    )

    $requiredFiles = @(
        (Join-Path $RootPath "node_modules\react\package.json"),
        (Join-Path $RootPath "node_modules\typescript\package.json"),
        (Join-Path $RootPath "node_modules\vite\package.json")
    )

    foreach ($file in $requiredFiles) {
        if (-not (Test-Path -LiteralPath $file)) {
            return $false
        }

        $item = Get-Item -LiteralPath $file
        if ($item.Length -le 0) {
            return $false
        }
    }

    return $true
}

function Sync-PackageManifests {
    param(
        [Parameter(Mandatory = $true)]
        [string]$SourceRoot,
        [Parameter(Mandatory = $true)]
        [string]$TargetRoot
    )

    $copiedOrChanged = $false
    foreach ($fileName in $packageManifestFiles) {
        $sourcePath = Join-Path $SourceRoot $fileName
        $targetPath = Join-Path $TargetRoot $fileName

        if (-not (Test-Path -LiteralPath $sourcePath)) {
            if (Test-Path -LiteralPath $targetPath) {
                Remove-Item -LiteralPath $targetPath -Force
                $copiedOrChanged = $true
            }
            continue
        }

        $shouldCopy = $true
        if (Test-Path -LiteralPath $targetPath) {
            $sourceHash = (Get-FileHash -LiteralPath $sourcePath -Algorithm SHA256).Hash
            $targetHash = (Get-FileHash -LiteralPath $targetPath -Algorithm SHA256).Hash
            $shouldCopy = $sourceHash -ne $targetHash
        }

        if ($shouldCopy) {
            Copy-Item -LiteralPath $sourcePath -Destination $targetPath -Force
            $copiedOrChanged = $true
        }
    }

    return $copiedOrChanged
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

$npmCommand = Get-Command npm.cmd -ErrorAction SilentlyContinue
if (-not $npmCommand) {
    $npmCommand = Get-Command npm -ErrorAction SilentlyContinue
}

if (-not $npmCommand) {
    throw "npm was not found. Please install Node.js first."
}

New-Item -ItemType Directory -Path $localDepsRoot -Force | Out-Null
$manifestsChanged = Sync-PackageManifests -SourceRoot $projectRoot -TargetRoot $localDepsRoot
$localDepsReady = Test-UsableNodeModules -RootPath $localDepsRoot

if ($manifestsChanged -or -not $localDepsReady) {
    Write-Host "Preparing frontend dependencies in $localDepsRoot ..."
    Push-Location $localDepsRoot
    try {
        & $npmCommand.Source install
        if ($LASTEXITCODE -ne 0) {
            throw "npm install failed. Check Node.js or network access."
        }
    }
    finally {
        Pop-Location
    }
} else {
    Write-Host "Frontend dependencies are already prepared in $localDepsRoot."
}

New-Item -ItemType Directory -Path $verifyRoot -Force | Out-Null

Write-Host "Project setup completed."
