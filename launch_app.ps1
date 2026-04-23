param(
    [switch]$SkipLaunch,
    [switch]$NoOpen,
    [int]$Port = 5173
)

$ErrorActionPreference = "Stop"
$syncDirectories = @("src", "public", "legacy-python", ".vscode")
$syncFiles = @(
    "package.json",
    "index.html",
    "tsconfig.json",
    "vite.config.ts",
    "tailwind.config.ts",
    "postcss.config.js",
    "eslint.config.js",
    "README.md"
)

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

function Ensure-VerificationWorkspace {
    param(
        [Parameter(Mandatory = $true)]
        [string]$SourceRoot
    )

    $verifyRoot = "C:\codex-deps\tcm-home-care-verify"
    $backupDepsRoot = "C:\codex-deps\tcm-home-care\node_modules"

    if (-not (Test-Path -LiteralPath $backupDepsRoot)) {
        throw "Backup dependency tree not found: $backupDepsRoot. Run powershell -ExecutionPolicy Bypass -File .\.codex\scripts\setup.ps1 first."
    }

    if (-not (Test-Path -LiteralPath $verifyRoot)) {
        New-Item -ItemType Directory -Path $verifyRoot | Out-Null
    }

    Write-Host "Workspace is on a cloud-synced or restricted path. Syncing to a local verification copy before launch..."

    foreach ($relativePath in $syncDirectories) {
        $sourcePath = Join-Path $SourceRoot $relativePath
        if (Test-Path -LiteralPath $sourcePath) {
            $targetPath = Join-Path $verifyRoot $relativePath
            if (-not (Test-Path -LiteralPath $targetPath)) {
                New-Item -ItemType Directory -Path $targetPath -Force | Out-Null
            }
            & robocopy $sourcePath $targetPath /E /R:1 /W:1 /NFL /NDL /NJH /NJS /NP | Out-Null
            if ($LASTEXITCODE -gt 7) {
                throw "Failed to sync directory: $relativePath"
            }
        }
    }

    foreach ($relativePath in $syncFiles) {
        if (Test-Path -LiteralPath (Join-Path $SourceRoot $relativePath)) {
            & robocopy $SourceRoot $verifyRoot $relativePath /R:1 /W:1 /NFL /NDL /NJH /NJS /NP | Out-Null
            if ($LASTEXITCODE -gt 7) {
                throw "Failed to sync file: $relativePath"
            }
        }
    }

    $verifyNodeModules = Join-Path $verifyRoot "node_modules"
    $verifyViteCmd = Join-Path $verifyNodeModules ".bin\vite.cmd"
    if (Test-Path -LiteralPath $verifyViteCmd) {
        return $verifyRoot
    }

    if (Test-Path -LiteralPath $verifyNodeModules) {
        $nodeModulesItem = Get-Item -LiteralPath $verifyNodeModules -Force
        if ($nodeModulesItem.Attributes -band [IO.FileAttributes]::ReparsePoint) {
            cmd /c rmdir $verifyNodeModules | Out-Null
        } else {
            Remove-Item -LiteralPath $verifyNodeModules -Recurse -Force
        }
    }

    New-Item -ItemType Junction -Path $verifyNodeModules -Target $backupDepsRoot | Out-Null
    return $verifyRoot
}

function Resolve-RunRoot {
    param(
        [Parameter(Mandatory = $true)]
        [string]$ProjectRoot
    )

    $packageJson = Join-Path $ProjectRoot "package.json"
    if (-not (Test-Path -LiteralPath $packageJson)) {
        throw "package.json not found. Unable to launch the Web MVP."
    }

    if (Test-UsableNodeModules -RootPath $ProjectRoot) {
        return $ProjectRoot
    }

    return Ensure-VerificationWorkspace -SourceRoot $ProjectRoot
}

function Resolve-ViteCommand {
    param(
        [Parameter(Mandatory = $true)]
        [string]$RunRoot
    )

    $viteCmd = Join-Path $RunRoot "node_modules\.bin\vite.cmd"
    if (Test-Path -LiteralPath $viteCmd) {
        return $viteCmd
    }

    $npmCommand = Get-Command npm.cmd -ErrorAction SilentlyContinue
    if (-not $npmCommand) {
        $npmCommand = Get-Command npm -ErrorAction SilentlyContinue
    }

    if (-not $npmCommand) {
        throw "npm was not found. Please install Node.js first."
    }

    & $npmCommand.Source install

    if (-not (Test-Path -LiteralPath $viteCmd)) {
        throw "npm install completed, but vite.cmd is still missing."
    }

    return $viteCmd
}

function Test-PortAvailable {
    param(
        [Parameter(Mandatory = $true)]
        [int]$PortNumber
    )

    $listener = $null
    try {
        $listener = [System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Parse("127.0.0.1"), $PortNumber)
        $listener.Start()
        return $true
    }
    catch {
        return $false
    }
    finally {
        if ($listener) {
            $listener.Stop()
        }
    }
}

function Resolve-VitePort {
    param(
        [Parameter(Mandatory = $true)]
        [int]$PreferredPort
    )

    foreach ($candidatePort in $PreferredPort..($PreferredPort + 20)) {
        if (Test-PortAvailable -PortNumber $candidatePort) {
            return $candidatePort
        }
    }

    throw "Unable to find an available port between $PreferredPort and $($PreferredPort + 20)."
}

$projectRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$runRoot = Resolve-RunRoot -ProjectRoot $projectRoot
$viteCommand = Resolve-ViteCommand -RunRoot $runRoot
$selectedPort = Resolve-VitePort -PreferredPort $Port

Write-Host "Web MVP launch root: $runRoot"
if ($selectedPort -ne $Port) {
    Write-Host "Port $Port is already in use. Falling back to port $selectedPort."
}

if ($SkipLaunch) {
    Write-Host "Launch skipped."
    exit 0
}

Push-Location $runRoot
try {
    $viteArgs = @("--host", "127.0.0.1", "--port", $selectedPort.ToString(), "--strictPort")
    $openJob = $null
    if (-not $NoOpen) {
        $appUrl = "http://127.0.0.1:$selectedPort/"
        Write-Host "Trying to open browser at $appUrl"
        $openJob = Start-Job -ScriptBlock {
            param(
                [Parameter(Mandatory = $true)]
                [string]$Url
            )

            Start-Sleep -Seconds 2
            Start-Process $Url
        } -ArgumentList $appUrl
    }
    & $viteCommand @viteArgs
}
finally {
    if ($openJob) {
        Remove-Job -Job $openJob -Force -ErrorAction SilentlyContinue
    }
    Pop-Location
}
