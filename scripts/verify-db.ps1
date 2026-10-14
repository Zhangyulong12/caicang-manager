# Read-only verification. Does not create, migrate or reset any database.
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'common.ps1')
Enable-DockerCommand
docker exec caicang-postgres pg_isready -U caicang -d caicang
Assert-NativeSuccess 'PostgreSQL readiness'
docker exec caicang-postgres psql -U caicang -d caicang -c 'SELECT current_database(), version();'
Assert-NativeSuccess 'PostgreSQL query'
