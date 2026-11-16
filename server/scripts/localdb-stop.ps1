# Stops the local dev MySQL started by localdb-start.ps1 (data is kept).
$bin = 'C:\Program Files\MySQL\MySQL Server 8.4\bin'
& "$bin\mysqladmin.exe" --host=127.0.0.1 --port=3307 -uroot shutdown
if ($LASTEXITCODE -eq 0) { Write-Output 'MySQL on 3307 stopped' } else { Write-Output 'MySQL on 3307 was not running' }
