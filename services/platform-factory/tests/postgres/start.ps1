[CmdletBinding()]
param(
 [Parameter(Mandatory=$true)][ValidateSet('isolated-factory')][string]$Environment,
 [Parameter(Mandatory=$true)][ValidateRange(19000,25000)][int]$Port,
 [Parameter(Mandatory=$true)][string]$Directory
)
$ErrorActionPreference='Stop'
$workspace=(Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..\..\..\..')).Path
$allowedRoot=[IO.Path]::GetFullPath((Join-Path $workspace 'test-results'))+[IO.Path]::DirectorySeparatorChar
$target=[IO.Path]::GetFullPath($Directory)
if (!$target.StartsWith($allowedRoot,[StringComparison]::OrdinalIgnoreCase)) { throw 'Only a NEW directory below this workspace test-results is allowed.' }
if (Test-Path -LiteralPath $target) { throw 'Existing directories/databases are never reused or removed.' }
if (([IO.DriveInfo]::new([IO.Path]::GetPathRoot($target))).AvailableFreeSpace -lt 1GB) { throw 'Insufficient local test disk capacity; no files created.' }
if (Get-NetTCPConnection -State Listen -LocalPort $Port -ErrorAction SilentlyContinue) { throw 'Requested port is occupied; no existing process is touched.' }
$pgBin=Join-Path $env:USERPROFILE '.opera-finance-pg16\pgsql\bin'
$init=Join-Path $pgBin 'initdb.exe'
if (!(Test-Path -LiteralPath $init)) { throw 'Existing PostgreSQL 16 tools unavailable. Nothing is installed.' }
$version=& $init --version
if ($LASTEXITCODE -ne 0 -or $version -notmatch ' 16\.') { throw 'Requires existing PostgreSQL 16 tools.' }
New-Item -ItemType Directory -Path $target | Out-Null
$identity=[Security.Principal.WindowsIdentity]::GetCurrent().Name
& icacls.exe $target /inheritance:r /grant:r ($identity+':(OI)(CI)F') 'NT AUTHORITY\SYSTEM:(OI)(CI)F' | Out-Null
if ($LASTEXITCODE -ne 0) { throw 'Could not protect synthetic recovery/credential directory; stop.' }
$random=New-Object byte[] 36
$rng=[Security.Cryptography.RandomNumberGenerator]::Create()
try { $rng.GetBytes($random) } finally { $rng.Dispose() }
$password=[Convert]::ToBase64String($random)
$runId=[guid]::NewGuid().ToString()
$pwFile=Join-Path $target 'bootstrap-password.local'
[IO.File]::WriteAllText($pwFile,$password+[Environment]::NewLine)
$data=Join-Path $target 'data'
& $init -D $data --username=factory_admin --auth=scram-sha-256 ('--pwfile='+$pwFile) --encoding=UTF8 --locale=C *> (Join-Path $target 'init.log')
if ($LASTEXITCODE -ne 0) { throw 'New isolated cluster initialization failed. No existing cluster changed.' }
$options="-p $Port -h 127.0.0.1 -c max_connections=40 -c factory.test_run_id=$runId"
$metadata=@{classification='isolated-synthetic-factory';runId=$runId;host='127.0.0.1';port=$Port;user='factory_admin';password=$password;root=$target;data=$data;pgBin=$pgBin;database='postgres';startedAt=[DateTime]::UtcNow.ToString('o')}
[IO.File]::WriteAllText((Join-Path $target 'connection.local.json'),($metadata|ConvertTo-Json),([Text.UTF8Encoding]::new($false)))
$startArgs=@('-D',('"'+$data+'"'),'-l',('"'+(Join-Path $target 'postgres.log')+'"'),'-o',('"'+$options+'"'),'-w','start')
$launcher=Start-Process -FilePath (Join-Path $pgBin 'pg_ctl.exe') -ArgumentList $startArgs -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $target 'start.log') -RedirectStandardError (Join-Path $target 'start-error.log')
if (!$launcher.WaitForExit(20000)) { throw 'Isolated launcher did not finish. Inspect only this run metadata before continuing.' }
$launcher.Refresh()
if ($null -ne $launcher.ExitCode -and $launcher.ExitCode -ne 0) { throw 'New isolated cluster failed to start. No other server was restarted.' }
# Windows PowerShell 5 may return a null ExitCode for Start-Process objects.
# Verify the actual authenticated server marker instead of inferring success.
$savedPassword=$env:PGPASSWORD
try {
 $env:PGPASSWORD=$password
 $observed=& (Join-Path $pgBin 'psql.exe') -h 127.0.0.1 -p $Port -U factory_admin -d postgres -A -t -c "select current_setting('factory.test_run_id',true)" 2> (Join-Path $target 'verify-error.log')
 if ($LASTEXITCODE -ne 0 -or (($observed -join '').Trim()) -ne $runId) { throw 'Started cluster identity could not be verified; inspect this run only.' }
} finally { $env:PGPASSWORD=$savedPassword }
Write-Output ('Isolated synthetic PostgreSQL 16 started on loopback port '+$Port+'. Protected metadata: '+(Join-Path $target 'connection.local.json'))
