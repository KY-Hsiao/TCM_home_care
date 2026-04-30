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
  throw "目前無法判斷 git branch，已中止發布。"
}

if (-not $AllowNonProductionBranch -and $currentBranch -ne $ProductionBranch) {
  throw "目前 branch 為 '$currentBranch'，不是正式部署 branch '$ProductionBranch'。如確認要繼續，請加上 -AllowNonProductionBranch。"
}

$currentHead = (git rev-parse HEAD).Trim()
if ([string]::IsNullOrWhiteSpace($currentHead)) {
  throw "目前無法判斷 git HEAD，已中止發布。"
}

$pendingChanges = (git status --porcelain)
if ($pendingChanges) {
  Write-Warning "目前有未提交修改；本次發布只會包含已經 commit 的內容。"
}

Write-Host "推送目前分支到 GitHub：$currentBranch" -ForegroundColor Cyan
git push $Remote $currentBranch
if ($LASTEXITCODE -ne 0) {
  throw "git push 失敗，已停止。"
}

$githubActionSucceeded = $false
if ($WaitForGitHubActions) {
  $ghCommand = Get-Command gh -ErrorAction SilentlyContinue
  if ($null -eq $ghCommand) {
    Write-Warning "找不到 GitHub CLI（gh），已完成 git push，但無法等待 GitHub Actions 結果。"
  } else {
    Write-Host "等待 GitHub Actions Deploy to Vercel 觸發..." -ForegroundColor Cyan
    Start-Sleep -Seconds 3
    $runJson = gh run list `
      --workflow deploy-vercel.yml `
      --branch $currentBranch `
      --commit $currentHead `
      --limit 1 `
      --json databaseId,status,conclusion,displayTitle 2>$null

    if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($runJson)) {
      Write-Warning "找不到對應 commit 的 Deploy to Vercel workflow。若本次 push 沒有新 commit，GitHub 可能不會建立新 run。"
    } else {
      $runs = $runJson | ConvertFrom-Json
      $run = @($runs)[0]
      if ($null -eq $run -or $null -eq $run.databaseId) {
        Write-Warning "Deploy to Vercel workflow 尚未出現在 GitHub Actions 列表。"
      } else {
        Write-Host "正在等待 GitHub Actions run #$($run.databaseId) 完成..." -ForegroundColor Cyan
        gh run watch $run.databaseId --exit-status
        if ($LASTEXITCODE -ne 0) {
          throw "GitHub Actions Deploy to Vercel 失敗，請到 GitHub Actions 查看 run #$($run.databaseId)。"
        }
        $githubActionSucceeded = $true
        Write-Host "GitHub Actions Deploy to Vercel 已成功完成。" -ForegroundColor Green
      }
    }
  }
}

if ($SkipVercel) {
  Write-Host "已略過本機額外 Vercel deploy hook 觸發。" -ForegroundColor Yellow
  exit 0
}

$deployHookUrl = $env:VERCEL_DEPLOY_HOOK_URL
if ([string]::IsNullOrWhiteSpace($deployHookUrl)) {
  if ($githubActionSucceeded) {
    Write-Host "本機未設定 VERCEL_DEPLOY_HOOK_URL；已由 GitHub Actions 成功呼叫線上部署流程。" -ForegroundColor Green
    Write-Host "若要在本機動作中額外直接觸發 Vercel deploy hook，請設定環境變數 VERCEL_DEPLOY_HOOK_URL。" -ForegroundColor Yellow
    exit 0
  }
  throw "未設定環境變數 VERCEL_DEPLOY_HOOK_URL，且未確認 GitHub Actions 成功，無法確認 Vercel 觸發。"
}

Write-Host "同步觸發 Vercel 部署..." -ForegroundColor Cyan
$response = Invoke-RestMethod -Method Post -Uri $deployHookUrl

if ($null -ne $response) {
  $response | ConvertTo-Json -Depth 6
}

Write-Host "GitHub 與 Vercel 發布動作已完成。" -ForegroundColor Green
