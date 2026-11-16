# Local dev MySQL (project-local, port 3307, root without password, 127.0.0.1 only).
# Data: <repo>/.localdb/data (git-ignored). First run initializes it and loads sql/schema.sql.
# Usage: powershell -ExecutionPolicy Bypass -File server/scripts/localdb-start.ps1
$bin = 'C:\Program Files\MySQL\MySQL Server 8.4\bin'
$root = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$base = Join-Path $root '.localdb'
$data = Join-Path $base 'data'
$port = 3307
function Ping { & "$bin\mysqladmin.exe" --host=127.0.0.1 "--port=$port" -uroot ping 2>$null | Out-Null; return ($LASTEXITCODE -eq 0) }

New-Item -ItemType Directory -Force $base | Out-Null
if (-not (Test-Path $data)) {
  & "$bin\mysqld.exe" --no-defaults --initialize-insecure "--datadir=$data" "--log-error=$base\init.err"
  if ($LASTEXITCODE -ne 0) { throw "mysqld --initialize-insecure failed (see $base\init.err)" }
}
if (-not (Ping)) {
  # --no-defaults: never read the system my.ini (keeps any other MySQL install untouched)
  $mysqldArgs = @('--no-defaults', "--datadir=`"$data`"", "--port=$port", '--bind-address=127.0.0.1', '--mysqlx=OFF',
    "--log-error=`"$base\mysqld.err`"", '--character-set-server=utf8mb4')
  Start-Process -FilePath "$bin\mysqld.exe" -ArgumentList $mysqldArgs -WindowStyle Hidden
  $ok = $false
  for ($i = 0; $i -lt 30 -and -not $ok; $i++) { Start-Sleep -Seconds 1; $ok = Ping }
  if (-not $ok) { throw "MySQL did not start (see $base\mysqld.err)" }
}
$has = & "$bin\mysql.exe" --host=127.0.0.1 "--port=$port" -uroot -N -e "SHOW DATABASES LIKE 'teamchat'"
if (-not $has) {
  Get-Content -Raw -Encoding UTF8 (Join-Path $root 'server\sql\schema.sql') | & "$bin\mysql.exe" --host=127.0.0.1 "--port=$port" -uroot
  if ($LASTEXITCODE -ne 0) { throw 'schema.sql failed' }
  Write-Output 'Created database teamchat from schema.sql. Next: cd server; npm run seed'
}
Write-Output "MySQL running on 127.0.0.1:$port"
