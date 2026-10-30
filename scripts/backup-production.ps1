param([Parameter(Mandatory=$true)][string]$EnvFile,[Parameter(Mandatory=$true)][string]$OutputDirectory)
$ErrorActionPreference='Stop'
node (Join-Path $PSScriptRoot 'production-db.mjs') backup --env-file $EnvFile --output-dir $OutputDirectory
if($LASTEXITCODE -ne 0){throw 'Production backup failed; keep the original database unchanged.'}
