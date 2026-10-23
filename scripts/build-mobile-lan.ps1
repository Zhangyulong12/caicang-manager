param(
    [Parameter(Mandatory = $true)]
    [string]$ApiBaseUrl
)

$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'common.ps1')
$target = $null
$address = $null
if (-not [Uri]::TryCreate($ApiBaseUrl, [UriKind]::Absolute, [ref]$target) -or
    $target.Scheme -notin @('http', 'https') -or
    $target.UserInfo -or $target.Query -or $target.Fragment -or
    $target.AbsolutePath.TrimEnd('/') -ne '/api/v1' -or
    -not [Net.IPAddress]::TryParse($target.Host, [ref]$address) -or
    $address.AddressFamily -ne [Net.Sockets.AddressFamily]::InterNetwork -or
    [Net.IPAddress]::IsLoopback($address) -or $address.Equals([Net.IPAddress]::Any)) {
    throw 'Use the computer LAN IPv4 API URL, for example http://192.168.1.10:3000/api/v1.'
}

$normalized = $target.AbsoluteUri.TrimEnd('/')
$health = Invoke-WebRequest -UseBasicParsing -Uri ($normalized + '/health') -TimeoutSec 10
if ($health.StatusCode -ne 200) { throw 'API health check failed.' }

$previousApiUrl = $env:VITE_API_BASE_URL
Push-Location (Split-Path -Parent $PSScriptRoot)
try {
    # Process-only override: keep all existing .env files unchanged.
    $env:VITE_API_BASE_URL = $normalized
    pnpm.cmd --filter @caicang/mobile build:app --mode development
    Assert-NativeSuccess 'LAN App resource build'
    $bundlePath = Join-Path (Get-Location) 'apps/mobile/dist/build/app/app-service.js'
    if (-not (Test-Path -LiteralPath $bundlePath) -or
        -not ([IO.File]::ReadAllText($bundlePath).Contains($normalized))) {
        throw 'Built App resources do not contain the requested API URL.'
    }
    Write-Output "App resources contain API URL: $normalized"
    Write-Output 'Output: apps/mobile/dist/build/app. This is not an APK or a real-device acceptance result.'
} finally {
    $env:VITE_API_BASE_URL = $previousApiUrl
    Pop-Location
}
