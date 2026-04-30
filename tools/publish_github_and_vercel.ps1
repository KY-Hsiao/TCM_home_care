param(
  [string]$Remote = "origin",
  [string]$ProductionBranch = "main",
  [switch]$AllowNonProductionBranch,
  [switch]$SkipVercel,
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

$pendingChanges = (git status --porcelain)
if ($pendingChanges) {
  Write-Warning "There are uncommitted changes. This publish only includes committed content."
}

Write-Host "Pushing current branch to GitHub: $currentBranch" -ForegroundColor Cyan
git push $Remote $currentBranch
if ($LASTEXITCODE -ne 0) {
  throw "git push failed. Publish aborted."
}

$githubActionSucceeded = $false
if ($WaitForGitHubActions) {
  $ghCommand = Get-Command gh -ErrorAction SilentlyContinue
  if ($null -eq $ghCommand) {
    Write-Warning "GitHub CLI (gh) was not found. git push completed, but GitHub Actions cannot be watched locally."
  } else {
    Write-Host "Waiting for GitHub Actions Deploy to Vercel..." -ForegroundColor Cyan
    Start-Sleep -Seconds 3
    $runJson = gh run list `
      --workflow deploy-vercel.yml `
      --branch $currentBranch `
      --commit $currentHead `
      --limit 1 `
      --json databaseId,status,conclusion,displayTitle 2>$null

    if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($runJson)) {
      Write-Warning "No Deploy to Vercel workflow run was found for this commit. If no new commit was pushed, GitHub may not create a new run."
    } else {
      $runs = $runJson | ConvertFrom-Json
      $run = @($runs)[0]
      if ($null -eq $run -or $null -eq $run.databaseId) {
        Write-Warning "Deploy to Vercel workflow has not appeared in GitHub Actions yet."
      } else {
        Write-Host "Watching GitHub Actions run #$($run.databaseId)..." -ForegroundColor Cyan
        gh run watch $run.databaseId --exit-status
        if ($LASTEXITCODE -ne 0) {
          throw "GitHub Actions Deploy to Vercel failed. Check run #$($run.databaseId)."
        }
        $githubActionSucceeded = $true
        Write-Host "GitHub Actions Deploy to Vercel completed successfully." -ForegroundColor Green
      }
    }
  }
}

if ($SkipVercel) {
  Write-Host "Skipped the local extra Vercel deploy hook trigger." -ForegroundColor Yellow
  exit 0
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
