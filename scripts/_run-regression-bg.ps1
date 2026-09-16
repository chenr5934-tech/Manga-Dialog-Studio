# Kick off the full e2e regression in the background, detached from this shell.
$root = Split-Path -Parent $PSScriptRoot
$running = Get-CimInstance Win32_Process -Filter "Name='node.exe'" |
  Where-Object { $_.CommandLine -like '*_run-regression*' }
if ($running) {
  Write-Output ('already running: ' + ($running.ProcessId -join ','))
  exit 0
}
$stdout = Join-Path $root '_regression.stdout.log'
$stderr = Join-Path $root '_regression.stderr.log'
Start-Process -FilePath 'node' -ArgumentList 'scripts/_run-regression.mjs' -WorkingDirectory $root -RedirectStandardOutput $stdout -RedirectStandardError $stderr -WindowStyle Hidden
Start-Sleep -Seconds 2
Write-Output 'started'
