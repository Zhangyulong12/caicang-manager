$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'common.ps1')
Enable-DockerCommand
$projectRoot = Split-Path -Parent $PSScriptRoot
$envFile = Join-Path $projectRoot '.env'

if (-not (Test-Path -LiteralPath $envFile)) {
    $randomBytes = New-Object byte[] 32
    $rng = [Security.Cryptography.RandomNumberGenerator]::Create()
    try { $rng.GetBytes($randomBytes) } finally { $rng.Dispose() }
    $password = [BitConverter]::ToString($randomBytes).Replace('-', '').ToLowerInvariant()
    $contents = "POSTGRES_PASSWORD=$password`nDATABASE_URL=postgresql://caicang:$password@localhost:5432/caicang?schema=public`nAPI_PORT=3000`nWEB_ORIGIN=http://localhost:5173,http://localhost:5174`n"
    # CreateNew also prevents concurrent startup from overwriting an existing file.
    $stream = [IO.File]::Open($envFile, [IO.FileMode]::CreateNew, [IO.FileAccess]::Write, [IO.FileShare]::None)
    try {
        $encodedContents = (New-Object Text.UTF8Encoding($false)).GetBytes($contents)
        $stream.Write($encodedContents, 0, $encodedContents.Length)
    } finally { $stream.Dispose() }
    Write-Output 'Created local .env with a random database password (credentials not printed).'
} else {
    Write-Output 'Keeping existing .env without overwriting credentials or configuration.'
}

docker info --format 'Docker Server: {{.ServerVersion}}'
Assert-NativeSuccess 'Docker engine check'
docker compose --env-file $envFile -f (Join-Path $PSScriptRoot 'compose.dev.yml') up -d --wait --wait-timeout 120
Assert-NativeSuccess 'PostgreSQL startup'
docker compose --env-file $envFile -f (Join-Path $PSScriptRoot 'compose.dev.yml') ps
Assert-NativeSuccess 'Compose status'
