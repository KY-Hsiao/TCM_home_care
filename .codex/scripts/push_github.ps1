$ErrorActionPreference = "Stop"

foreach ($proxyVar in @("HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY", "GIT_HTTP_PROXY", "GIT_HTTPS_PROXY")) {
    Remove-Item "Env:$proxyVar" -ErrorAction SilentlyContinue
}

git push -u origin HEAD

if ($LASTEXITCODE -ne 0) {
    throw "Git push failed. Check authentication or remote settings."
}
