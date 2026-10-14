$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'common.ps1')
$projectRoot = Split-Path -Parent $PSScriptRoot
Push-Location $projectRoot
try {
    & (Join-Path $PSScriptRoot 'db-up.ps1')
    pnpm.cmd build:shared
    Assert-NativeSuccess 'Shared packages build'
    pnpm.cmd prisma:generate
    Assert-NativeSuccess 'Prisma Client generation'
    pnpm.cmd --parallel --filter @caicang/api --filter @caicang/admin-web dev
    Assert-NativeSuccess 'Development servers'
} finally { Pop-Location }
