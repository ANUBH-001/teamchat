# Starts the Android emulator AVD 'teamchat_test' and waits until it has booted.
# SDK: D:\Android\Sdk (override with $env:ANDROID_HOME). Usage: .\emulator-start.ps1
$sdk = if ($env:ANDROID_HOME) { $env:ANDROID_HOME } else { 'D:\Android\Sdk' }
$emu = Join-Path $sdk 'emulator\emulator.exe'
$adb = Join-Path $sdk 'platform-tools\adb.exe'

Start-Process -FilePath $emu -ArgumentList '-avd', 'teamchat_test', '-no-snapshot', '-gpu', 'auto'
# -e targets the emulator only (a USB phone may also be attached)
& $adb -e wait-for-device
do {
    Start-Sleep -Seconds 3
    $booted = (& $adb -e shell getprop sys.boot_completed 2>$null) -join ''
} until ($booted.Trim() -eq '1')
Write-Host 'Emulator teamchat_test is booted.'
