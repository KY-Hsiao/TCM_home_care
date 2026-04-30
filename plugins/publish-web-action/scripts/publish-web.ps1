param(
  [switch]$AllowNonProductionBranch,
  [switch]$SkipVercel
)

$ErrorActionPreference = "Stop"

$repoRoot = Resolve-Path (Join-Path $PSScriptRoot "..\..\..")
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
