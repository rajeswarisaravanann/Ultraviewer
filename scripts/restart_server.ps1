$port = 3000
$pids = Get-NetTCPConnection -LocalPort $port -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess -ErrorAction SilentlyContinue
if ($pids) {
  foreach ($procId in $pids) {
    Write-Host "Killing process on port $port -> PID: $procId"
    try { taskkill /PID $procId /F } catch { Write-Host ("Failed to kill {0}: {1}" -f $procId, $_) }
  }
} else {
  Write-Host "No process found on port $port"
}

Set-Location "c:\Users\rajes\Downloads\Ultraviewer\server"
Write-Host "Starting signaling server (node index.js) in: $(Get-Location)"
node index.js
