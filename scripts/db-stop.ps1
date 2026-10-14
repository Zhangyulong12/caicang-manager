$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'common.ps1')
Enable-DockerCommand
$envFile = Join-Path (Split-Path -Parent $PSScriptRoot) '.env'
if (-not (Test-Path -LiteralPath $envFile)) { throw 'Local .env missing. Run pnpm db:up first.' }

# stop preserves both the container and named volume. Never reset or remove data.
docker compose --env-file $envFile -f (Join-Path $PSScriptRoot 'compose.dev.yml') stop --timeout 30 postgres
Assert-NativeSuccess 'PostgreSQL stop'
docker compose --env-file $envFile -f (Join-Path $PSScriptRoot 'compose.dev.yml') ps --all
Assert-NativeSuccess 'Compose status'
Write-Output 'PostgreSQL stopped. Container and persistent volume retained.'
