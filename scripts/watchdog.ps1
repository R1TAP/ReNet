param(
  [int]$ParentPid,
  [int]$ChildPid,
  [string]$Serial,
  [string]$AdbPath
)

# Wait at kernel level until parent process terminates (normal exit, force kill, or crash)
if ($ParentPid -gt 0) {
  Wait-Process -Id $ParentPid -ErrorAction SilentlyContinue
}

# Immediately kill child process
if ($ChildPid -gt 0) {
  Stop-Process -Id $ChildPid -Force -ErrorAction SilentlyContinue
}

# Targeted removal of gnirehtet reverse tunnel only
if ($AdbPath -and (Test-Path $AdbPath)) {
  if ($Serial -and $Serial -ne 'All Devices') {
    & $AdbPath -s $Serial reverse --remove localabstract:gnirehtet 2>$null
  } else {
    & $AdbPath reverse --remove localabstract:gnirehtet 2>$null
  }
}
