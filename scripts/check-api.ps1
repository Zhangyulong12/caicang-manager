param([string]$ApiBaseUrl = 'http://localhost:3000/api/v1')
$ErrorActionPreference = 'Stop'

$uri = $ApiBaseUrl.TrimEnd('/') + '/health'
try { $result = Invoke-RestMethod -Uri $uri -Method Get -TimeoutSec 10 } catch {
    throw 'API health request failed. Start the API and check database connectivity.'
}
if ($result.data.status -ne 'ok' -or $result.data.database -ne 'reachable' -or $result.data.service -ne 'caicang-api') {
    throw 'API health response does not confirm a reachable database.'
}
$result | ConvertTo-Json -Depth 4
