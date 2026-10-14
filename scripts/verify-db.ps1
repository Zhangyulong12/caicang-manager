# Read-only verification. Does not create, migrate or reset any database.
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'common.ps1')
Enable-DockerCommand
$health = docker inspect caicang-postgres --format '{{.State.Health.Status}}'
Assert-NativeSuccess 'PostgreSQL container inspection'
if ($health -ne 'healthy') { throw 'PostgreSQL container is not healthy. Run pnpm db:up.' }
docker exec caicang-postgres pg_isready -U caicang -d caicang
Assert-NativeSuccess 'PostgreSQL readiness'
# TCP requires password authentication; psql without -h would use a local socket.
# Expand container environment inside sh; never print the password on the host.
'SELECT current_database(), current_user, version();' | docker exec -i caicang-postgres sh -c 'export PGPASSWORD=$POSTGRES_PASSWORD; exec psql -h 127.0.0.1 -U caicang -d caicang -v ON_ERROR_STOP=1'
Assert-NativeSuccess 'PostgreSQL query'
