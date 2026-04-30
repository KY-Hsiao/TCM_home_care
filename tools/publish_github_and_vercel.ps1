param(
  [string]$Remote = "origin",
  [string]$ProductionBranch = "main",
  [switch]$AllowNonProductionBranch,
  [switch]$SkipVercel
)

$ErrorActionPreference = "Stop"

$currentBranch = (git branch --show-current).Trim()
if ([string]::IsNullOrWhiteSpace($currentBranch)) {
  throw "目前無法判斷 git branch，已中止發布。"
}

if (-not $AllowNonProductionBranch -and $currentBranch -ne $ProductionBranch) {
  throw "目前 branch 為 '$currentBranch'，不是正式部署 branch '$ProductionBranch'。如確認要繼續，請加上 -AllowNonProductionBranch。"
}

Write-Host "推送目前分支到 GitHub：$currentBranch" -ForegroundColor Cyan
git push $Remote $currentBranch
if ($LASTEXITCODE -ne 0) {
  throw "git push 失敗，已停止。"
}

if ($SkipVercel) {
  Write-Host "已略過 Vercel 觸發。" -ForegroundColor Yellow
  exit 0
}

$deployHookUrl = $env:VERCEL_DEPLOY_HOOK_URL
if ([string]::IsNullOrWhiteSpace($deployHookUrl)) {
  throw "未設定環境變數 VERCEL_DEPLOY_HOOK_URL，無法同步觸發 Vercel。"
}

Write-Host "同步觸發 Vercel 部署..." -ForegroundColor Cyan
$response = Invoke-RestMethod -Method Post -Uri $deployHookUrl

if ($null -ne $response) {
  $response | ConvertTo-Json -Depth 6
}

Write-Host "GitHub 與 Vercel 發布動作已完成。" -ForegroundColor Green
