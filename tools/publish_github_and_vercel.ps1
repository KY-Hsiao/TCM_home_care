param(
  [string]$Remote = "origin",
  [string]$ProductionBranch = "main",
  [switch]$AllowNonProductionBranch,
  [switch]$SkipVercel,
  [switch]$CommitPendingChanges,
  [string]$CommitMessage = "",
  $WaitForGitHubActions = $true,
  [int]$GitPushTimeoutSeconds = 180,
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
  $stdoutBuilder = [System.Text.StringBuilder]::new()
  $stderrBuilder = [System.Text.StringBuilder]::new()

  $stdoutHandler = [System.Diagnostics.DataReceivedEventHandler]{
    param($sender, $eventArgs)
    if ($null -ne $eventArgs.Data) {
      [void]$stdoutBuilder.AppendLine($eventArgs.Data)
    }
  }
  $stderrHandler = [System.Diagnostics.DataReceivedEventHandler]{
    param($sender, $eventArgs)
    if ($null -ne $eventArgs.Data) {
      [void]$stderrBuilder.AppendLine($eventArgs.Data)
    }
  }
  $process.add_OutputDataReceived($stdoutHandler)
  $process.add_ErrorDataReceived($stderrHandler)

  if (-not $process.Start()) {
    throw "$Description failed to start."
  }

  $process.BeginOutputReadLine()
  $process.BeginErrorReadLine()

  $completed = $process.WaitForExit($TimeoutSeconds * 1000)
  if (-not $completed) {
    try {
      $process.Kill($true)
    } catch {
      $process.Kill()
    }
    throw "$Description timed out after $TimeoutSeconds seconds. Check network access and authentication, then retry."
  }

  $process.WaitForExit()
  $stdout = $stdoutBuilder.ToString()
  $stderr = $stderrBuilder.ToString()
  $process.remove_OutputDataReceived($stdoutHandler)
  $process.remove_ErrorDataReceived($stderrHandler)
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
  throw "Invalid boolean value '$Value' for WaitForGitHubActions. Use true/false, 1/0, yes/no, or on/off."
}

$shouldWaitForGitHubActions = ConvertTo-BooleanOption -Value $WaitForGitHubActions -Default $true

$currentBranch = (git branch --show-current).Trim()
if ([string]::IsNullOrWhiteSpace($currentBranch)) {
  throw "Cannot resolve current git branch. Publish aborted."
}

if (-not $AllowNonProductionBranch -and $currentBranch -ne $ProductionBranch) {
  throw "Current branch '$currentBranch' is not production branch '$ProductionBranch'. Use -AllowNonProductionBranch to continue."
}

$currentHead = (git rev-parse HEAD).Trim()
if ([string]::IsNullOrWhiteSpace($currentHead)) {
  throw "Cannot resolve git HEAD. Publish aborted."
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
    if ($runStatusResult.ExitCode -ne 0 -or [string]::IsNullOrWhiteSpace($runStatusJson)) {
      Write-Host "Deploy workflow status unavailable. Retry $attempt/$MaxAttempts..." -ForegroundColor DarkYellow
      Start-Sleep -Seconds $IntervalSeconds
      continue
    }

    $runStatus = $runStatusJson | ConvertFrom-Json
    $state = "$($runStatus.status):$($runStatus.conclusion)"
    if ($state -ne $lastPrintedState) {
      $lastPrintedState = $state
      $conclusionText = if ([string]::IsNullOrWhiteSpace($runStatus.conclusion)) { "pending" } else { $runStatus.conclusion }
      Write-Host "Deploy workflow status: $($runStatus.status), conclusion: $conclusionText" -ForegroundColor Cyan
    } elseif ($attempt % 6 -eq 0) {
      Write-Host "Deploy workflow still running. Retry $attempt/$MaxAttempts..." -ForegroundColor DarkCyan
    }

    if ($runStatus.status -eq "completed") {
      if ($runStatus.conclusion -eq "success") {
        Write-Host "GitHub Actions Deploy to Vercel completed successfully." -ForegroundColor Green
        return
      }

      $runUrl = if ([string]::IsNullOrWhiteSpace($runStatus.url)) { "GitHub Actions run $RunId" } else { $runStatus.url }
      throw "GitHub Actions Deploy to Vercel failed with conclusion '$($runStatus.conclusion)'. Check $runUrl."
    }

    Start-Sleep -Seconds $IntervalSeconds
  }

  throw "GitHub Actions Deploy to Vercel did not complete within $($MaxAttempts * $IntervalSeconds) seconds."
}

$pendingChanges = (git status --porcelain)
if ($pendingChanges) {
  if ($CommitPendingChanges) {
    if ([string]::IsNullOrWhiteSpace($CommitMessage)) {
      $timestamp = Get-Date -Format "yyyy-MM-dd HH:mm"
      $CommitMessage = "Update project from Codex action $timestamp"
    }

    Write-Host "Committing pending changes before publish..." -ForegroundColor Cyan
    git add -A
    if ($LASTEXITCODE -ne 0) {
      throw "git add failed. Publish aborted."
    }

    git commit -m $CommitMessage
    if ($LASTEXITCODE -ne 0) {
      throw "git commit failed. Check git user.name/user.email and the pending changes."
    }

    $currentHead = (git rev-parse HEAD).Trim()
    if ([string]::IsNullOrWhiteSpace($currentHead)) {
      throw "Cannot resolve git HEAD after commit. Publish aborted."
    }
  } else {
    Write-Warning "There are uncommitted changes. This publish only includes committed content."
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
$workflowDispatched = $false
if ($shouldWaitForGitHubActions) {
  $ghCommand = Get-Command gh -ErrorAction SilentlyContinue
  if ($null -eq $ghCommand) {
    Write-Warning "GitHub CLI (gh) was not found. git push completed, but GitHub Actions cannot be watched locally."
  } else {
    Write-Host "Waiting for GitHub Actions Deploy to Vercel..." -ForegroundColor Cyan
    $runJson = $null
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

    if ($runListResult.ExitCode -ne 0 -or [string]::IsNullOrWhiteSpace($runJson) -or $runJson -eq "[]") {
      Write-Warning "No Deploy to Vercel workflow run was found for this commit. Triggering workflow_dispatch instead."
      $dispatchResult = Invoke-NativeTextCommand `
        -FilePath "gh" `
        -Arguments @("workflow", "run", "deploy-vercel.yml", "--ref", $currentBranch) `
        -TimeoutSeconds $GitHubCliTimeoutSeconds `
        -Description "gh workflow run deploy-vercel.yml" `
        -AllowFailure
      if ($dispatchResult.ExitCode -ne 0) {
        Write-Warning "Could not dispatch Deploy to Vercel workflow. GitHub push completed, but deployment was not confirmed."
      } else {
        $workflowDispatched = $true
        for ($attempt = 1; $attempt -le 12; $attempt += 1) {
          Start-Sleep -Seconds 5
          $runListResult = Invoke-NativeTextCommand `
            -FilePath "gh" `
            -Arguments @(
              "run", "list",
              "--workflow", "deploy-vercel.yml",
              "--branch", $currentBranch,
              "--limit", "1",
              "--json", "databaseId,status,conclusion,displayTitle"
            ) `
            -TimeoutSeconds $GitHubCliTimeoutSeconds `
            -Description "gh run list after workflow_dispatch" `
            -AllowFailure
          $runJson = $runListResult.StdOut
          if ($runListResult.ExitCode -eq 0 -and -not [string]::IsNullOrWhiteSpace($runJson) -and $runJson -ne "[]") {
            break
          }
          Write-Host "Dispatched deploy workflow is not visible yet. Retry $attempt/12..." -ForegroundColor DarkYellow
        }
      }
    }

    if ($runListResult.ExitCode -ne 0 -or [string]::IsNullOrWhiteSpace($runJson) -or $runJson -eq "[]") {
      Write-Warning "Deploy to Vercel workflow run could not be found."
    } else {
      $runs = $runJson | ConvertFrom-Json
      $run = @($runs)[0]
      if ($null -eq $run -or $null -eq $run.databaseId) {
        Write-Warning "Deploy to Vercel workflow has not appeared in GitHub Actions yet."
      } else {
        Write-Host "Watching GitHub Actions run #$($run.databaseId)..." -ForegroundColor Cyan
        Wait-GitHubRunQuietly -RunId $run.databaseId
        $githubActionSucceeded = $true
        if ($workflowDispatched) {
          Write-Host "GitHub Actions Deploy to Vercel completed successfully after workflow_dispatch." -ForegroundColor Green
        }
      }
    }
  }
}

$deployHookUrl = $env:VERCEL_DEPLOY_HOOK_URL
if ([string]::IsNullOrWhiteSpace($deployHookUrl)) {
  if ($githubActionSucceeded) {
    Write-Host "Local VERCEL_DEPLOY_HOOK_URL is not set. GitHub Actions has already triggered the online deploy flow." -ForegroundColor Green
    Write-Host "Set local VERCEL_DEPLOY_HOOK_URL only if you also want this script to directly trigger the Vercel deploy hook." -ForegroundColor Yellow
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
