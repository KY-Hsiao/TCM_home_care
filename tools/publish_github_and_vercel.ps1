param(
  [string]$Remote = "origin",
  [string]$ProductionBranch = "main",
  [switch]$AllowNonProductionBranch,
  [switch]$SkipVercel,
  [switch]$CommitPendingChanges,
  [string]$CommitMessage = "",
  [bool]$WaitForGitHubActions = $true
)

$ErrorActionPreference = "Stop"

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
    $runStatusJson = gh run view $RunId --json status,conclusion,url 2>$null
    if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($runStatusJson)) {
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
git push $Remote $currentBranch
if ($LASTEXITCODE -ne 0) {
  throw "git push failed. Publish aborted."
}

if ($SkipVercel) {
  Write-Host "Skipped Vercel deployment and GitHub Actions waiting. GitHub push completed." -ForegroundColor Yellow
  exit 0
}

$githubActionSucceeded = $false
$workflowDispatched = $false
if ($WaitForGitHubActions) {
  $ghCommand = Get-Command gh -ErrorAction SilentlyContinue
  if ($null -eq $ghCommand) {
    Write-Warning "GitHub CLI (gh) was not found. git push completed, but GitHub Actions cannot be watched locally."
  } else {
    Write-Host "Waiting for GitHub Actions Deploy to Vercel..." -ForegroundColor Cyan
    $runJson = $null
    for ($attempt = 1; $attempt -le 12; $attempt += 1) {
      Start-Sleep -Seconds 5
      $runJson = gh run list `
        --workflow deploy-vercel.yml `
        --branch $currentBranch `
        --commit $currentHead `
        --limit 1 `
        --json databaseId,status,conclusion,displayTitle 2>$null
      if ($LASTEXITCODE -eq 0 -and -not [string]::IsNullOrWhiteSpace($runJson) -and $runJson -ne "[]") {
        break
      }
      Write-Host "Deploy workflow is not visible yet. Retry $attempt/12..." -ForegroundColor DarkYellow
    }

    if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($runJson) -or $runJson -eq "[]") {
      Write-Warning "No Deploy to Vercel workflow run was found for this commit. Triggering workflow_dispatch instead."
      gh workflow run deploy-vercel.yml --ref $currentBranch
      if ($LASTEXITCODE -ne 0) {
        Write-Warning "Could not dispatch Deploy to Vercel workflow. GitHub push completed, but deployment was not confirmed."
      } else {
        $workflowDispatched = $true
        for ($attempt = 1; $attempt -le 12; $attempt += 1) {
          Start-Sleep -Seconds 5
          $runJson = gh run list `
            --workflow deploy-vercel.yml `
            --branch $currentBranch `
            --limit 1 `
            --json databaseId,status,conclusion,displayTitle 2>$null
          if ($LASTEXITCODE -eq 0 -and -not [string]::IsNullOrWhiteSpace($runJson) -and $runJson -ne "[]") {
            break
          }
          Write-Host "Dispatched deploy workflow is not visible yet. Retry $attempt/12..." -ForegroundColor DarkYellow
        }
      }
    }

    if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($runJson) -or $runJson -eq "[]") {
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
$response = Invoke-RestMethod -Method Post -Uri $deployHookUrl

if ($null -ne $response) {
  $response | ConvertTo-Json -Depth 6
}

Write-Host "GitHub and Vercel publish action completed." -ForegroundColor Green
