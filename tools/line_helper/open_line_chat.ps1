param(
    [string]$DoctorId = "",
    [string]$DoctorName = "",
    [string]$LineSearchKeyword = "",
    [string]$Phone = "",
    [switch]$LaunchLineIfNeeded,
    [string]$LineWindowHint = "LINE"
)

$ErrorActionPreference = "Stop"

function New-Result {
    param(
        [Parameter(Mandatory = $true)]
        [bool]$Success,
        [Parameter(Mandatory = $true)]
        [string]$Stage,
        [Parameter(Mandatory = $true)]
        [string]$Message,
        [Parameter(Mandatory = $true)]
        [bool]$FallbackRecommended
    )

    return @{
        success = $Success
        stage = $Stage
        message = $Message
        fallbackRecommended = $FallbackRecommended
    }
}

function Write-ResultAndExit {
    param(
        [Parameter(Mandatory = $true)]
        [hashtable]$Result,
        [int]$Code = 0
    )

    $Result | ConvertTo-Json -Compress
    exit $Code
}

function Escape-SendKeysText {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Text
    )

    $escaped = $Text
    $replacements = @{
        "+" = "{+}"
        "^" = "{^}"
        "%" = "{%}"
        "~" = "{~}"
        "(" = "{(}"
        ")" = "{)}"
        "[" = "{[}"
        "]" = "{]}"
        "{" = "{{}"
        "}" = "{}}"
    }

    foreach ($entry in $replacements.GetEnumerator()) {
        $escaped = $escaped.Replace($entry.Key, $entry.Value)
    }

    return $escaped
}

function Start-LineDesktopApp {
    $existingProcess = Get-Process -Name "LINE" -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($existingProcess) {
        return $true
    }

    try {
        $lineApp = Get-StartApps | Where-Object { $_.Name -like "LINE*" } | Select-Object -First 1
        if ($lineApp) {
            Start-Process "shell:AppsFolder\$($lineApp.AppID)" | Out-Null
            Start-Sleep -Seconds 2
            return $true
        }
    } catch {
    }

    $candidatePaths = @(
        (Join-Path $env:LocalAppData "LINE\bin\LineLauncher.exe"),
        (Join-Path $env:LocalAppData "Programs\LINE\Line.exe"),
        (Join-Path $env:ProgramFiles "LINE\Line.exe"),
        (Join-Path ${env:ProgramFiles(x86)} "LINE\Line.exe")
    ) | Where-Object { $_ }

    foreach ($candidatePath in $candidatePaths) {
        if (Test-Path -LiteralPath $candidatePath) {
            Start-Process -FilePath $candidatePath | Out-Null
            Start-Sleep -Seconds 2
            return $true
        }
    }

    return $false
}

function Activate-LineWindow {
    param(
        [Parameter(Mandatory = $true)]
        $Shell,
        [string]$WindowHint = "LINE"
    )

    $candidates = @()
    if ($WindowHint) {
        $candidates += $WindowHint
    }
    $candidates += @("LINE")

    foreach ($candidate in ($candidates | Select-Object -Unique)) {
        for ($attempt = 0; $attempt -lt 5; $attempt += 1) {
            if ($Shell.AppActivate($candidate)) {
                Start-Sleep -Milliseconds 300
                return $true
            }
            Start-Sleep -Milliseconds 400
        }
    }

    return $false
}

if (-not $LineSearchKeyword.Trim()) {
    Write-ResultAndExit -Result (New-Result -Success $false -Stage "validate_request" -Message "此醫師尚未設定 LINE 搜尋關鍵字。" -FallbackRecommended $true)
}

if ($LaunchLineIfNeeded) {
    if (-not (Start-LineDesktopApp)) {
        Write-ResultAndExit -Result (New-Result -Success $false -Stage "launch_line" -Message "找不到可啟動的桌面 LINE 程式。" -FallbackRecommended $true)
    }
}

$shell = New-Object -ComObject WScript.Shell
if (-not (Activate-LineWindow -Shell $shell -WindowHint $LineWindowHint)) {
    Write-ResultAndExit -Result (New-Result -Success $false -Stage "locate_window" -Message "無法聚焦到桌面 LINE 視窗。" -FallbackRecommended $true)
}

$shell.SendKeys("^f")
Start-Sleep -Milliseconds 300
$shell.SendKeys("^a")
Start-Sleep -Milliseconds 150
$shell.SendKeys((Escape-SendKeysText -Text $LineSearchKeyword.Trim()))
Start-Sleep -Milliseconds 500
$shell.SendKeys("{ENTER}")
Start-Sleep -Milliseconds 500

$displayName = if ($DoctorName.Trim()) { $DoctorName.Trim() } else { $LineSearchKeyword.Trim() }
Write-ResultAndExit -Result (New-Result -Success $true -Stage "open_chat" -Message "已切換到 $displayName 的 LINE 對話。" -FallbackRecommended $false)
