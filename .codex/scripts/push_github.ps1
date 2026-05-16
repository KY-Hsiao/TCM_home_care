$ErrorActionPreference = "Stop"

foreach ($proxyVar in @("HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY", "GIT_HTTP_PROXY", "GIT_HTTPS_PROXY")) {
    Remove-Item "Env:$proxyVar" -ErrorAction SilentlyContinue
}

$repoRoot = Resolve-Path (Join-Path $PSScriptRoot "..\..")
Set-Location $repoRoot

& ".\tools\publish_github_and_vercel.ps1" -SkipVercel -CommitPendingChanges -NoWaitForGitHubActions

if ($LASTEXITCODE -ne 0) {
    throw "Git push failed. Check authentication or remote settings."
}
