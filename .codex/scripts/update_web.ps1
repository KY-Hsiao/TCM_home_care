$ErrorActionPreference = "Stop"

$repoRoot = Resolve-Path (Join-Path $PSScriptRoot "..\..")
Set-Location $repoRoot

& ".\tools\publish_github_and_vercel.ps1" -CommitPendingChanges -NoWaitForGitHubActions
