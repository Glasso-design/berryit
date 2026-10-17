# Local transport for the existing BerryIT backend. Changes nothing on the server.
[CmdletBinding()]
param(
    [string]$IdentityFile = "$env:USERPROFILE\.ssh\prod-node-home"
)
$ErrorActionPreference = 'Stop'

function Test-BerryITConnection {
    try {
        $gateway = Invoke-WebRequest -UseBasicParsing -Uri 'http://127.0.0.1:8700/health' -TimeoutSec 2
        if ($gateway.StatusCode -ne 200 -or $gateway.Content.Trim() -ne 'berryit-support gateway ok') { return $false }
        $auth = Invoke-WebRequest -UseBasicParsing -Uri 'http://127.0.0.1:8700/auth/v1/health' -TimeoutSec 2
        return $auth.StatusCode -eq 200
    } catch { return $false }
}

if (Test-BerryITConnection) {
    Write-Output 'BerryIT backend and Auth are reachable. Reusing the existing local connection.'
    exit 0
}
if (Get-NetTCPConnection -LocalPort 8700 -State Listen -ErrorAction SilentlyContinue) {
    throw 'Port 8700 is occupied by an unverified service. Nothing was stopped or replaced.'
}
if (!(Test-Path -LiteralPath $IdentityFile -PathType Leaf)) {
    throw 'The existing SSH identity is unavailable. No key is generated or installed.'
}
if ($IdentityFile.Contains('"')) { throw 'Invalid identity path.' }
$ssh = (Get-Command ssh.exe -ErrorAction Stop).Source
$logDir = Join-Path $PSScriptRoot '..\.local'
New-Item -ItemType Directory -Path $logDir -Force | Out-Null
$stamp = Get-Date -Format 'yyyyMMddTHHmmssfff'
$logFile = Join-Path $logDir "ssh-$stamp.log"
$sshArgs = @(
    '-N', '-T', '-i', ('"' + $IdentityFile + '"'),
    '-o', 'IdentitiesOnly=yes', '-o', 'BatchMode=yes',
    '-o', 'StrictHostKeyChecking=yes', '-o', 'UpdateHostKeys=no',
    '-o', 'ExitOnForwardFailure=yes', '-o', 'ConnectTimeout=10',
    '-o', 'ServerAliveInterval=30', '-o', 'ServerAliveCountMax=3',
    '-L', '127.0.0.1:8700:127.0.0.1:8700', 'ubuntu@100.100.11.6'
)
$process = Start-Process -FilePath $ssh -ArgumentList $sshArgs -WindowStyle Hidden -PassThru -RedirectStandardError $logFile
for ($attempt = 0; $attempt -lt 12; $attempt++) {
    Start-Sleep -Milliseconds 500
    $process.Refresh()
    if ($process.HasExited) { throw "SSH forwarding failed (exit $($process.ExitCode)). See $logFile" }
    if (Test-BerryITConnection) {
        @{ pid = $process.Id; started = $process.StartTime.ToUniversalTime().ToString('o'); target = 'ubuntu@100.100.11.6'; localPort = 8700; log = $logFile } |
            ConvertTo-Json | Set-Content -LiteralPath (Join-Path $logDir 'backend-tunnel.json') -Encoding UTF8
        Write-Output "BerryIT gateway and Auth: HTTP 200. Local SSH tunnel PID $($process.Id)."
        exit 0
    }
}
# Only the SSH helper created above can be stopped on failure.
if (!$process.HasExited) { $process.Kill() }
throw 'BerryIT could not be verified through the new tunnel. The helper was stopped; server services were unchanged.'
