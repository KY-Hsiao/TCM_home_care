param(
  [switch]$AllowNonProductionBranch,
  [switch]$SkipVercel
)

$ErrorActionPreference = "Stop"

$candidateRoots = @(
  $env:TCM_HOME_CARE_REPO,
  (Get-Location).Path,
  "C:\Codex\TCM_home_care",
  (Join-Path $PSScriptRoot "..\..\..")
) | Where-Object { -not [string]::IsNullOrWhiteSpace($_) }

$repoRoot = $null
foreach ($candidateRoot in $candidateRoots) {
  $resolvedRoot = Resolve-Path $candidateRoot -ErrorAction SilentlyContinue
  if ($resolvedRoot -and (Test-Path (Join-Path $resolvedRoot "package.json")) -and (Test-Path (Join-Path $resolvedRoot "tools\publish_github_and_vercel.ps1"))) {
    $repoRoot = $resolvedRoot
    break
  }
}

if ($null -eq $repoRoot) {
  throw "Cannot find TCM_home_care repo root. Run from the project folder or set TCM_HOME_CARE_REPO."
}

Set-Location $repoRoot

$arguments = @(
  "-ExecutionPolicy",
  "Bypass",
  "-File",
  ".\tools\publish_github_and_vercel.ps1"
)

if ($AllowNonProductionBranch) {
  $arguments += "-AllowNonProductionBranch"
}

if ($SkipVercel) {
  $arguments += "-SkipVercel"
}

& powershell @arguments
