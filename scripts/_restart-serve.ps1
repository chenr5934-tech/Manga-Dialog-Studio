# Restart the local editor service (scripts/serve.mjs) without touching other node processes.
# Run from Bash: powershell -NoProfile -ExecutionPolicy Bypass -File scripts/_restart-serve.ps1
$root = Split-Path -Parent $PSScriptRoot
Get-CimInstance Win32_Process -Filter "Name='node.exe'" |
  Where-Object { $_.CommandLine -like '*serve.mjs*' } |
  ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
Start-Sleep -Milliseconds 900
Start-Process -FilePath 'node' -ArgumentList 'scripts/serve.mjs' -WorkingDirectory $root -WindowStyle Hidden
Start-Sleep -Seconds 2
