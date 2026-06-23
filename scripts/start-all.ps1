$root = Split-Path -Parent $MyInvocation.MyCommand.Definition
Write-Host "Starting UltraViewer server, host, and viewer..."
Start-Process pwsh -ArgumentList "-NoExit", "-Command", "Set-Location '$root'; cd server; npm start" -WindowStyle Normal
Start-Process pwsh -ArgumentList "-NoExit", "-Command", "Set-Location '$root'; cd host; npm start" -WindowStyle Normal
Start-Process pwsh -ArgumentList "-NoExit", "-Command", "Set-Location '$root'; cd viewer; npm start" -WindowStyle Normal
Write-Host "All start commands launched."
