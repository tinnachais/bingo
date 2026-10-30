# Register Cruise Bingo (Node) and Caddy as Windows services using NSSM.
# Run in an ELEVATED PowerShell (Run as Administrator).
#
#   powershell -ExecutionPolicy Bypass -File .\install-service.ps1
#
# Prereqs already installed (see DEPLOY-WINDOWS.md):
#   - Node.js (node on PATH)
#   - nssm.exe           default: C:\tools\nssm\nssm.exe
#   - caddy.exe + Caddyfile  default: C:\tools\caddy\
#   - app code checked out   default: C:\apps\cruise-bingo  (with node_modules installed)

param(
	[string]$AppDir   = "C:\apps\cruise-bingo",
	[string]$Nssm     = "C:\tools\nssm\nssm.exe",
	[string]$CaddyDir = "C:\tools\caddy",
	[int]   $Port     = 3000
)

$ErrorActionPreference = "Stop"

function Require-Path($p, $what) {
	if (-not (Test-Path $p)) { throw "ไม่พบ $what ที่ $p — ติดตั้งก่อนตาม DEPLOY-WINDOWS.md" }
}

Require-Path $Nssm "nssm.exe"
Require-Path $AppDir "โฟลเดอร์แอป"
Require-Path (Join-Path $AppDir "server.js") "server.js"
Require-Path (Join-Path $CaddyDir "caddy.exe") "caddy.exe"
Require-Path (Join-Path $CaddyDir "Caddyfile") "Caddyfile"

$node = (Get-Command node -ErrorAction SilentlyContinue).Source
if (-not $node) { throw "ไม่พบ node บน PATH — ติดตั้ง Node.js ก่อน" }
Write-Host "ใช้ node: $node"

# --- Node app service ---------------------------------------------------
Write-Host "ติดตั้ง service: CruiseBingo"
& $Nssm install CruiseBingo $node "server.js" | Out-Null
& $Nssm set CruiseBingo AppDirectory $AppDir | Out-Null
& $Nssm set CruiseBingo AppEnvironmentExtra "PORT=$Port" "HOST=127.0.0.1" "NODE_ENV=production" | Out-Null
& $Nssm set CruiseBingo Start SERVICE_AUTO_START | Out-Null
& $Nssm set CruiseBingo AppStdout "$AppDir\logs\app.out.log" | Out-Null
& $Nssm set CruiseBingo AppStderr "$AppDir\logs\app.err.log" | Out-Null
New-Item -ItemType Directory -Force -Path "$AppDir\logs" | Out-Null

# --- Caddy reverse-proxy service ---------------------------------------
Write-Host "ติดตั้ง service: CruiseBingoCaddy"
& $Nssm install CruiseBingoCaddy (Join-Path $CaddyDir "caddy.exe") "run --config `"$CaddyDir\Caddyfile`" --adapter caddyfile" | Out-Null
& $Nssm set CruiseBingoCaddy AppDirectory $CaddyDir | Out-Null
& $Nssm set CruiseBingoCaddy Start SERVICE_AUTO_START | Out-Null
& $Nssm set CruiseBingoCaddy AppStdout "$CaddyDir\caddy.out.log" | Out-Null
& $Nssm set CruiseBingoCaddy AppStderr "$CaddyDir\caddy.err.log" | Out-Null

# --- Firewall ----------------------------------------------------------
Write-Host "เปิดไฟร์วอลล์ 80/443"
foreach ($p in 80, 443) {
	if (-not (Get-NetFirewallRule -DisplayName "Cruise Bingo $p" -ErrorAction SilentlyContinue)) {
		New-NetFirewallRule -DisplayName "Cruise Bingo $p" -Direction Inbound -Action Allow -Protocol TCP -LocalPort $p | Out-Null
	}
}

# --- Start -------------------------------------------------------------
Write-Host "เริ่ม service"
& $Nssm start CruiseBingo | Out-Null
Start-Sleep -Seconds 2
& $Nssm start CruiseBingoCaddy | Out-Null

Write-Host ""
Write-Host "เสร็จแล้ว! เปิด https://bingo.pssgroup.app"
Write-Host "ตรวจสถานะ:  Get-Service CruiseBingo, CruiseBingoCaddy"
Write-Host "ดู log แอป:  Get-Content $AppDir\logs\app.err.log -Tail 50"
Write-Host "ดู log Caddy: Get-Content $CaddyDir\caddy.err.log -Tail 50"
