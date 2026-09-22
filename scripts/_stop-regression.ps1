# Stop a running regression run and its headless browsers, then put the personal
# folders (uploads / config) back the way they were before the run started.
$root = Split-Path -Parent $PSScriptRoot

$targets = Get-CimInstance Win32_Process -Filter "Name='node.exe'" |
  Where-Object { $_.CommandLine -like '*_run-regression*' -or $_.CommandLine -like '*scripts/e2e-*' }
foreach ($p in $targets) { Stop-Process -Id $p.ProcessId -Force -ErrorAction SilentlyContinue }

$browsers = Get-CimInstance Win32_Process -Filter "Name='chrome.exe'" |
  Where-Object { $_.CommandLine -like '*puppeteer_dev_chrome_profile*' }
foreach ($p in $browsers) { Stop-Process -Id $p.ProcessId -Force -ErrorAction SilentlyContinue }

Start-Sleep -Seconds 2

# 寄存目录（runner 与套件各一层）里的东西要放回原处，
# 否则中途停下时用户的素材库会一直卡在 .stash 里。
foreach ($dir in @('uploads', 'config')) {
  $path = Join-Path $root $dir
  if (-not (Test-Path $path)) { continue }
  Get-ChildItem -Path $path -Directory -Force -ErrorAction SilentlyContinue |
    Where-Object { $_.Name -like '.stash*' } |
    ForEach-Object {
      $stash = $_
      Get-ChildItem -Path $stash.FullName -File -Force -ErrorAction SilentlyContinue | ForEach-Object {
        Move-Item -Force -LiteralPath $_.FullName -Destination (Join-Path $path $_.Name)
      }
      Remove-Item -Recurse -Force -LiteralPath $stash.FullName -ErrorAction SilentlyContinue
    }
}

foreach ($dir in @('uploads', 'config')) {
  $path = Join-Path $root $dir
  if (-not (Test-Path $path)) { continue }
  Get-ChildItem -Path $path -Filter '*.regression-backup' -File -ErrorAction SilentlyContinue | ForEach-Object {
    $target = $_.FullName -replace '\.regression-backup$', ''
    Move-Item -Force -LiteralPath $_.FullName -Destination $target
  }
  Get-ChildItem -Path $path -Filter '*.guard-backup' -File -ErrorAction SilentlyContinue | ForEach-Object {
    $target = $_.FullName -replace '\.guard-backup$', ''
    Move-Item -Force -LiteralPath $_.FullName -Destination $target
  }
}

Write-Output ('stopped ' + $targets.Count + ' script(s), ' + $browsers.Count + ' browser(s)')
