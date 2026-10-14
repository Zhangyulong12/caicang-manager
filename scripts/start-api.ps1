$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'common.ps1')
$projectRoot = Split-Path -Parent $PSScriptRoot
Push-Location $projectRoot
try {
    & (Join-Path $PSScriptRoot 'db-up.ps1')
    pnpm.cmd prisma:generate
    Assert-NativeSuccess 'Prisma Client generation'
    pnpm.cmd build:shared
    Assert-NativeSuccess 'Shared packages build'
    pnpm.cmd --filter @caicang/api build
    Assert-NativeSuccess 'API build'
    Write-Output 'Starting API in this terminal. Use Ctrl+C to stop the API.'
    pnpm.cmd --filter @caicang/api start
    Assert-NativeSuccess 'API startup'
} finally { Pop-Location }
