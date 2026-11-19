# OTA update banao (expo export) aur server par bhejne ke commands print karo. Server touch nahi karta.
param([string]$RuntimeVersion = "1")
$ErrorActionPreference = 'Stop'
if (-not (Test-Path 'T:\')) { subst T: 'D:\r&D\team-app' }   # '&' in the real path breaks npx
Set-Location T:\app
if (Test-Path dist-update) { Remove-Item -Recurse -Force dist-update }
npx expo export --platform android --output-dir dist-update
if ($LASTEXITCODE -ne 0) { throw 'expo export fail' }
$cfg = npx expo config --json --type public | Out-String
[IO.File]::WriteAllText('T:\app\dist-update\expoConfig.json', $cfg, (New-Object Text.UTF8Encoding($false)))  # UTF-8, no BOM
$stamp = Get-Date -Format 'yyyyMMddHHmmss'
$tgz = "T:\app\update-$stamp.tar.gz"
tar -czf $tgz -C T:\app\dist-update .
Write-Host "`nBundle ready: $tgz  (runtime $RuntimeVersion, folder $stamp)`n"
Write-Host "Upload (server par):"
Write-Host "  scp $tgz root@<server>:/tmp/update-$stamp.tar.gz"
Write-Host "  ssh root@<server> `"mkdir -p /opt/node/team-chat/server/updates/$RuntimeVersion/$stamp && tar -xzf /tmp/update-$stamp.tar.gz -C /opt/node/team-chat/server/updates/$RuntimeVersion/$stamp && rm /tmp/update-$stamp.tar.gz`""
Write-Host "Server restart ki zarurat nahi. Rollback: server par latest folder delete."
