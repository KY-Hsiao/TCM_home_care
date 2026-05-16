param(
  [string]$Remote = "origin",
  [string]$ProductionBranch = "main",
  [switch]$AllowNonProductionBranch,
  [switch]$SkipVercel,
  [switch]$CommitPendingChanges,
  [switch]$NoWaitForGitHubActions,
  [string]$CommitMessage = "",
  $WaitForGitHubActions = $true,
  [int]$GitPushTimeoutSeconds = 180,
  [int]$GitLocalTimeoutSeconds = 60,
  [int]$GitHubCliTimeoutSeconds = 45,
  [int]$DeployHookTimeoutSeconds = 60
)

$ErrorActionPreference = "Stop"

$env:GIT_TERMINAL_PROMPT = "0"
$env:GIT_ASKPASS = "echo"
$env:GCM_INTERACTIVE = "Never"
$env:GH_PROMPT_DISABLED = "1"
$env:GH_NO_UPDATE_NOTIFIER = "1"
$env:SSH_ASKPASS = "echo"

foreach ($proxyVar in @("HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY", "GIT_HTTP_PROXY", "GIT_HTTPS_PROXY")) {
  Remove-Item "Env:$proxyVar" -ErrorAction SilentlyContinue
}

function ConvertTo-BooleanOption {
  param(
    [Parameter(Mandatory = $true)]
    [object]$Value,
    [bool]$Default = $true
  )

  if ($Value -is [bool]) {
    return $Value
  }
  if ($Value -is [int]) {
    return $Value -ne 0
  }
  $text = [string]$Value
  if ([string]::IsNullOrWhiteSpace($text)) {
    return $Default
  }
  $normalized = $text.Trim().ToLowerInvariant()
  if ($normalized -in @("false", "`$false", "0", "no", "off")) {
    return $false
  }
  if ($normalized -in @("true", "`$true", "1", "yes", "on")) {
    return $true
  }
  throw "Invalid boolean value '$Value' for WaitForGitHubActions."
}

function ConvertTo-ProcessArgument {
  param(
    [AllowNull()]
    [string]$Argument
  )

  if ($null -eq $Argument) {
    return '""'
  }
  if ($Argument -notmatch '[\s"]') {
    return $Argument
  }
  return '"' + ($Argument -replace '"', '\"') + '"'
}

function Invoke-NativeTextCommand {
  param(
    [Parameter(Mandatory = $true)]
    [string]$FilePath,
    [Parameter(Mandatory = $true)]
    [string[]]$Arguments,
    [Parameter(Mandatory = $true)]
    [int]$TimeoutSeconds,
    [Parameter(Mandatory = $true)]
    [string]$Description,
    [switch]$AllowFailure
  )

  $processInfo = [System.Diagnostics.ProcessStartInfo]::new()
  $processInfo.FileName = $FilePath
  $processInfo.WorkingDirectory = (Get-Location).Path
  $processInfo.UseShellExecute = $false
  $processInfo.RedirectStandardOutput = $true
  $processInfo.RedirectStandardError = $true
  $processInfo.Arguments = ($Arguments | ForEach-Object { ConvertTo-ProcessArgument -Argument $_ }) -join " "

  $process = [System.Diagnostics.Process]::new()
  $process.StartInfo = $processInfo
  if (-not $process.Start()) {
    throw "$Description failed to start."
  }

  $stdoutTask = $process.StandardOutput.ReadToEndAsync()
  $stderrTask = $process.StandardError.ReadToEndAsync()
  $completed = $process.WaitForExit($TimeoutSeconds * 1000)
  if (-not $completed) {
    try {
      $process.Kill($true)
    } catch {
      $process.Kill()
    }
    throw "$Description timed out after $TimeoutSeconds seconds. Check network access and authentication, then retry."
  }

  $stdout = $stdoutTask.Result
  $stderr = $stderrTask.Result
  $result = [pscustomobject]@{
    ExitCode = $process.ExitCode
    StdOut = $stdout
    StdErr = $stderr
  }

  if (-not $AllowFailure -and $result.ExitCode -ne 0) {
    $details = @($stdout, $stderr) -join "`n"
    throw "$Description failed with exit code $($result.ExitCode). $details"
  }

  return $result
}

function Test-GitHubCliAuth {
  $authResult = Invoke-NativeTextCommand `
    -FilePath "gh" `
    -Arguments @("auth", "status") `
    -TimeoutSeconds $GitHubCliTimeoutSeconds `
    -Description "gh auth status" `
    -AllowFailure

  if ($authResult.ExitCode -eq 0) {
    return $true
  }

  $details = @($authResult.StdOut, $authResult.StdErr) -join "`n"
  Write-Warning "Local gh auth is unavailable, so Actions status cannot be confirmed from this machine."
  if (-not [string]::IsNullOrWhiteSpace($details)) {
    Write-Warning $details.Trim()
  }
  return $false
}

function Wait-GitHubRunQuietly {
  param(
    [Parameter(Mandatory = $true)]
    [string]$RunId,
    [int]$MaxAttempts = 120,
    [int]$IntervalSeconds = 5
  )

  $lastPrintedState = ""
  for ($attempt = 1; $attempt -le $MaxAttempts; $attempt += 1) {
    $runStatusResult = Invoke-NativeTextCommand `
      -FilePath "gh" `
      -Arguments @("run", "view", $RunId, "--json", "status,conclusion,url") `
      -TimeoutSeconds $GitHubCliTimeoutSeconds `
      -Description "gh run view $RunId" `
      -AllowFailure

    $runStatusJson = $runStatusResult.StdOut
    if ($runStatusResult.ExitCode -eq 0 -and -not [string]::IsNullOrWhiteSpace($runStatusJson)) {
      $runStatus = $runStatusJson | ConvertFrom-Json
      $state = "$($runStatus.status):$($runStatus.conclusion)"
      if ($state -ne $lastPrintedState) {
        $lastPrintedState = $state
        $conclusionText = if ([string]::IsNullOrWhiteSpace($runStatus.conclusion)) { "pending" } else { $runStatus.conclusion }
        Write-Host "Deploy workflow status: $($runStatus.status), conclusion: $conclusionText" -ForegroundColor Cyan
      }
      if ($runStatus.status -eq "completed") {
        if ($runStatus.conclusion -eq "success") {
          Write-Host "GitHub Actions Deploy to Vercel completed successfully." -ForegroundColor Green
          return
        }
        $runUrl = if ([string]::IsNullOrWhiteSpace($runStatus.url)) { "GitHub Actions run $RunId" } else { $runStatus.url }
        throw "GitHub Actions Deploy to Vercel failed with conclusion '$($runStatus.conclusion)'. Check $runUrl."
      }
    }

    if ($attempt % 6 -eq 0) {
      Write-Host "Deploy workflow still running. Retry $attempt/$MaxAttempts..." -ForegroundColor DarkCyan
    }
    Start-Sleep -Seconds $IntervalSeconds
  }

  throw "GitHub Actions Deploy to Vercel did not complete within $($MaxAttempts * $IntervalSeconds) seconds."
}

$shouldWaitForGitHubActions = (ConvertTo-BooleanOption -Value $WaitForGitHubActions -Default $true) -and -not $NoWaitForGitHubActions

$currentBranch = (Invoke-NativeTextCommand `
  -FilePath "git" `
  -Arguments @("branch", "--show-current") `
  -TimeoutSeconds $GitLocalTimeoutSeconds `
  -Description "git branch --show-current").StdOut.Trim()
if ([string]::IsNullOrWhiteSpace($currentBranch)) {
  throw "Cannot resolve current git branch. Publish aborted."
}

if (-not $AllowNonProductionBranch -and $currentBranch -ne $ProductionBranch) {
  throw "Current branch '$currentBranch' is not production branch '$ProductionBranch'. Use -AllowNonProductionBranch to continue."
}

$currentHead = (Invoke-NativeTextCommand `
  -FilePath "git" `
  -Arguments @("rev-parse", "HEAD") `
  -TimeoutSeconds $GitLocalTimeoutSeconds `
  -Description "git rev-parse HEAD").StdOut.Trim()

$pendingChanges = (Invoke-NativeTextCommand `
  -FilePath "git" `
  -Arguments @("status", "--porcelain") `
  -TimeoutSeconds $GitLocalTimeoutSeconds `
  -Description "git status --porcelain").StdOut
if ($pendingChanges) {
  if (-not $CommitPendingChanges) {
    Write-Warning "There are uncommitted changes. This publish only includes committed content."
  }

  if ($CommitPendingChanges) {
    if ([string]::IsNullOrWhiteSpace($CommitMessage)) {
      $timestamp = Get-Date -Format "yyyy-MM-dd HH:mm"
      $CommitMessage = "Update project from Codex action $timestamp"
    }

    Write-Host "Committing pending changes before publish..." -ForegroundColor Cyan
    Invoke-NativeTextCommand `
      -FilePath "git" `
      -Arguments @("add", "-A") `
      -TimeoutSeconds $GitLocalTimeoutSeconds `
      -Description "git add" | Out-Null
    Invoke-NativeTextCommand `
      -FilePath "git" `
      -Arguments @("commit", "-m", $CommitMessage) `
      -TimeoutSeconds $GitLocalTimeoutSeconds `
      -Description "git commit" | Out-Null

    $currentHead = (Invoke-NativeTextCommand `
      -FilePath "git" `
      -Arguments @("rev-parse", "HEAD") `
      -TimeoutSeconds $GitLocalTimeoutSeconds `
      -Description "git rev-parse HEAD after commit").StdOut.Trim()
  }
}

Write-Host "Pushing current branch to GitHub: $currentBranch" -ForegroundColor Cyan
$pushResult = Invoke-NativeTextCommand `
  -FilePath "git" `
  -Arguments @("-c", "credential.interactive=false", "push", $Remote, $currentBranch) `
  -TimeoutSeconds $GitPushTimeoutSeconds `
  -Description "git push"
$pushOutput = @($pushResult.StdOut, $pushResult.StdErr) -join "`n"
if (-not [string]::IsNullOrWhiteSpace($pushOutput)) {
  Write-Host $pushOutput.Trim()
}

if ($SkipVercel) {
  Write-Host "Skipped Vercel deployment and GitHub Actions waiting. GitHub push completed." -ForegroundColor Yellow
  exit 0
}

$githubActionSucceeded = $false
$githubActionsWatchSkippedReason = ""
if ($shouldWaitForGitHubActions) {
  $ghCommand = Get-Command gh -ErrorAction SilentlyContinue
  if ($null -eq $ghCommand) {
    $githubActionsWatchSkippedReason = "GitHub CLI (gh) was not found."
    Write-Warning "$githubActionsWatchSkippedReason GitHub push completed, but Actions cannot be watched locally."
  }

  if ($null -ne $ghCommand -and -not (Test-GitHubCliAuth)) {
    $githubActionsWatchSkippedReason = "Local gh auth is unavailable."
    Write-Warning "Skipped GitHub Actions watch because local gh authentication is unavailable."
  }

  if ($null -ne $ghCommand -and [string]::IsNullOrWhiteSpace($githubActionsWatchSkippedReason)) {
    Write-Host "Waiting for GitHub Actions Deploy to Vercel..." -ForegroundColor Cyan
    $runJson = ""
    $runListResult = $null
    for ($attempt = 1; $attempt -le 12; $attempt += 1) {
      Start-Sleep -Seconds 5
      $runListResult = Invoke-NativeTextCommand `
        -FilePath "gh" `
        -Arguments @(
          "run", "list",
          "--workflow", "deploy-vercel.yml",
          "--branch", $currentBranch,
          "--commit", $currentHead,
          "--limit", "1",
          "--json", "databaseId,status,conclusion,displayTitle"
        ) `
        -TimeoutSeconds $GitHubCliTimeoutSeconds `
        -Description "gh run list for commit $currentHead" `
        -AllowFailure
      $runJson = $runListResult.StdOut
      if ($runListResult.ExitCode -eq 0 -and -not [string]::IsNullOrWhiteSpace($runJson) -and $runJson -ne "[]") {
        break
      }
      Write-Host "Deploy workflow is not visible yet. Retry $attempt/12..." -ForegroundColor DarkYellow
    }

    $runFound = $null -ne $runListResult -and $runListResult.ExitCode -eq 0 -and -not [string]::IsNullOrWhiteSpace($runJson) -and $runJson -ne "[]"
    if ($runFound) {
      $runs = $runJson | ConvertFrom-Json
      $run = @($runs)[0]
      if ($null -ne $run -and $null -ne $run.databaseId) {
        Write-Host "Watching GitHub Actions run #$($run.databaseId)..." -ForegroundColor Cyan
        Wait-GitHubRunQuietly -RunId $run.databaseId
        $githubActionSucceeded = $true
      }
    }

    if (-not $runFound) {
      Write-Warning "Deploy to Vercel workflow run could not be found for this commit."
    }
  }
}

if (-not $shouldWaitForGitHubActions) {
  Write-Host "Skipped local GitHub Actions waiting. GitHub push completed. Repository push workflow can trigger Vercel online." -ForegroundColor Yellow
}

$deployHookUrl = $env:VERCEL_DEPLOY_HOOK_URL
if ([string]::IsNullOrWhiteSpace($deployHookUrl)) {
  if ($githubActionSucceeded) {
    Write-Host "Local VERCEL_DEPLOY_HOOK_URL is not set. GitHub Actions has already triggered the online deploy flow." -ForegroundColor Green
    exit 0
  }
  if (-not $shouldWaitForGitHubActions) {
    Write-Host "Local VERCEL_DEPLOY_HOOK_URL is not set. Publish finished after GitHub push without local Actions waiting." -ForegroundColor Yellow
    exit 0
  }
  if (-not [string]::IsNullOrWhiteSpace($githubActionsWatchSkippedReason)) {
    Write-Warning "VERCEL_DEPLOY_HOOK_URL is not set and GitHub Actions success was not confirmed. $githubActionsWatchSkippedReason"
    exit 0
  }
  throw "VERCEL_DEPLOY_HOOK_URL is not set and GitHub Actions success was not confirmed. Cannot confirm Vercel trigger."
}

Write-Host "Triggering Vercel deployment through local deploy hook..." -ForegroundColor Cyan
$response = Invoke-RestMethod -Method Post -Uri $deployHookUrl -TimeoutSec $DeployHookTimeoutSeconds
if ($null -ne $response) {
  $response | ConvertTo-Json -Depth 6
}
Write-Host "GitHub and Vercel publish action completed." -ForegroundColor Green
