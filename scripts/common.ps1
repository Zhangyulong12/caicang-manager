$ErrorActionPreference = 'Stop'

function Enable-DockerCommand {
    if (-not (Get-Command docker.exe -ErrorAction SilentlyContinue)) {
        $dockerBin = Join-Path $env:LOCALAPPDATA 'Programs\DockerDesktop\resources\bin'
        if (-not (Test-Path -LiteralPath (Join-Path $dockerBin 'docker.exe'))) {
            throw 'Docker CLI not found. Install/start Docker Desktop and reopen your terminal.'
        }
        $env:Path = "$dockerBin;$env:Path"
    }
}

function Assert-NativeSuccess([string]$Operation) {
    if ($LASTEXITCODE -ne 0) { throw "$Operation failed with exit code $LASTEXITCODE" }
}
