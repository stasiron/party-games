param(
    [Parameter(Mandatory = $false)]
    [string]$PiHost = "stas@192.168.1.52",
    [Parameter(Mandatory = $false)]
    [string]$PiRoot = "/home/stas"
)

$ErrorActionPreference = "Stop"

Write-Host "==> Build Pi (npm run build:pi)"
Push-Location (Join-Path $PSScriptRoot "..")
try {
    npm run build:pi
} finally {
    Pop-Location
}

$distPath = (Resolve-Path (Join-Path $PSScriptRoot "..\dist")).Path
$piPath = (Resolve-Path $PSScriptRoot).Path

Write-Host "==> Upload dist to $PiHost`:$PiRoot/dist/"
scp -r "$distPath/*" "$PiHost`:$PiRoot/dist/"

Write-Host "==> Upload pi scripts to $PiHost`:$PiRoot/pi/"
scp -r "$piPath/*" "$PiHost`:$PiRoot/pi/"

Write-Host "==> Restart services on Pi"
ssh $PiHost "pm2 restart party-web || true; pm2 restart firebase-db || true; pm2 save || true"

Write-Host "Deploy complete."
