param([Parameter(Mandatory=$true)][string]$EnvFile,[Parameter(Mandatory=$true)][string]$BackupFile,[Parameter(Mandatory=$true)][string]$NewDatabase)
$ErrorActionPreference='Stop'
node (Join-Path $PSScriptRoot 'production-db.mjs') restore --env-file $EnvFile --backup $BackupFile --target-database $NewDatabase
if($LASTEXITCODE -ne 0){throw 'Restore failed. The original database has not been replaced.'}
