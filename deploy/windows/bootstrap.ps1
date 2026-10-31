<#
  Cruise Bingo — all-in-one installer for Windows Server.
  ติดตั้งครบจบ: Node + NSSM + Caddy + โค้ด + service + ไฟร์วอลล์ + HTTPS อัตโนมัติ

  วิธีใช้ (เปิด PowerShell แบบ Run as Administrator แล้ว paste บรรทัดเดียว):

    Set-ExecutionPolicy Bypass -Scope Process -Force; `
    [Net.ServicePointManager]::SecurityProtocol=[Net.SecurityProtocolType]::Tls12; `
    iwr https://raw.githubusercontent.com/tinnachais/bingo/claude/peaceful-gauss-0b70su/deploy/windows/bootstrap.ps1 -OutFile $env:TEMP\bootstrap.ps1; `
    & $env:TEMP\bootstrap.ps1

  รันซ้ำได้ (idempotent) — ถ้ามี service อยู่แล้วจะลบแล้วตั้งใหม่
#>

param(
  [string]$Domain   = "bingo.pssgroup.app",
  [string]$Branch   = "claude/peaceful-gauss-0b70su",
  [string]$AppDir   = "C:\apps\cruise-bingo",
  [string]$ToolsDir = "C:\tools",
  [int]   $Port     = 3000,
  [string]$NodeVer  = "22.11.0",
  [string]$CaddyVer = "2.8.4"
)

$ErrorActionPreference = "Stop"
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
function Say($m){ Write-Host "`n==> $m" -ForegroundColor Cyan }
function Warn($m){ Write-Host "!! $m" -ForegroundColor Yellow }

# --- 0. ต้องเป็น Administrator ---
$admin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $admin) { throw "ต้องเปิด PowerShell แบบ Run as Administrator" }

$NodeDir  = Join-Path $ToolsDir "node"
$NssmExe  = Join-Path $ToolsDir "nssm\nssm.exe"
$CaddyDir = Join-Path $ToolsDir "caddy"
$CaddyExe = Join-Path $CaddyDir "caddy.exe"
New-Item -ItemType Directory -Force -Path $ToolsDir, (Split-Path $AppDir) | Out-Null

# --- 1. ตรวจ DNS (เตือนถ้ายังไม่ชี้มาเครื่องนี้) ---
Say "ตรวจ DNS ของ $Domain"
try {
  $myip = (Invoke-RestMethod "https://api.ipify.org?format=text")
  $dns  = (Resolve-DnsName $Domain -Type A -ErrorAction Stop | Where-Object {$_.IPAddress} | Select-Object -First 1).IPAddress
  Write-Host "   IP เครื่องนี้ (public): $myip"
  Write-Host "   $Domain ชี้ไปที่      : $dns"
  if ($dns -ne $myip) { Warn "DNS ยังไม่ชี้มาที่เครื่องนี้ — Caddy จะขอใบรับรอง HTTPS ไม่ได้จนกว่าจะชี้ถูก (ตั้ง A record $Domain -> $myip)" }
} catch { Warn "ตรวจ DNS ไม่ได้: $($_.Exception.Message) — ตรวจเองว่า $Domain ชี้มาที่เครื่องนี้" }

# --- 2. Node.js (portable zip) ---
if (Test-Path (Join-Path $NodeDir "node.exe")) {
  Say "มี Node อยู่แล้วที่ $NodeDir"
} else {
  Say "ดาวน์โหลด Node.js v$NodeVer"
  $nz = "$env:TEMP\node.zip"
  Invoke-WebRequest "https://nodejs.org/dist/v$NodeVer/node-v$NodeVer-win-x64.zip" -OutFile $nz
  Expand-Archive $nz -DestinationPath "$env:TEMP\node_x" -Force
  $src = Get-ChildItem "$env:TEMP\node_x" -Directory | Select-Object -First 1
  if (Test-Path $NodeDir) { Remove-Item $NodeDir -Recurse -Force }
  Move-Item $src.FullName $NodeDir
}
$NodeExe = Join-Path $NodeDir "node.exe"
$NpmCmd  = Join-Path $NodeDir "npm.cmd"
Write-Host "   node: $(& $NodeExe -v)"

# --- 3. NSSM ---
if (Test-Path $NssmExe) {
  Say "มี NSSM อยู่แล้ว"
} else {
  Say "ดาวน์โหลด NSSM"
  $zz = "$env:TEMP\nssm.zip"
  Invoke-WebRequest "https://nssm.cc/release/nssm-2.24.zip" -OutFile $zz
  Expand-Archive $zz -DestinationPath "$env:TEMP\nssm_x" -Force
  New-Item -ItemType Directory -Force -Path (Split-Path $NssmExe) | Out-Null
  Copy-Item "$env:TEMP\nssm_x\nssm-2.24\win64\nssm.exe" $NssmExe -Force
}

# --- 4. Caddy ---
if (Test-Path $CaddyExe) {
  Say "มี Caddy อยู่แล้ว"
} else {
  Say "ดาวน์โหลด Caddy v$CaddyVer"
  $cz = "$env:TEMP\caddy.zip"
  Invoke-WebRequest "https://github.com/caddyserver/caddy/releases/download/v$CaddyVer/caddy_${CaddyVer}_windows_amd64.zip" -OutFile $cz
  Expand-Archive $cz -DestinationPath "$env:TEMP\caddy_x" -Force
  New-Item -ItemType Directory -Force -Path $CaddyDir | Out-Null
  Copy-Item "$env:TEMP\caddy_x\caddy.exe" $CaddyExe -Force
}

# --- 5. ดึงโค้ดแอป ---
Say "ดึงโค้ดแอป (branch $Branch)"
$az = "$env:TEMP\bingo.zip"
$branchFile = $Branch.Replace('/','-')
Invoke-WebRequest "https://github.com/tinnachais/bingo/archive/refs/heads/$Branch.zip" -OutFile $az
Expand-Archive $az -DestinationPath "$env:TEMP\bingo_x" -Force
$srcApp = Join-Path "$env:TEMP\bingo_x" "bingo-$branchFile"
if (Test-Path $AppDir) { Remove-Item $AppDir -Recurse -Force }
Move-Item $srcApp $AppDir

# --- 6. npm ci ---
Say "ติดตั้ง dependency (npm ci)"
Push-Location $AppDir
& $NpmCmd ci --omit=dev
Pop-Location
New-Item -ItemType Directory -Force -Path (Join-Path $AppDir "logs") | Out-Null

# --- 7. เขียน Caddyfile ---
Say "เขียน Caddyfile สำหรับ $Domain"
@"
$Domain {
	encode zstd gzip
	reverse_proxy 127.0.0.1:$Port
}
"@ | Set-Content -Path (Join-Path $CaddyDir "Caddyfile") -Encoding UTF8

# --- 8. ตั้ง service (ลบของเก่าถ้ามี) ---
Say "ตั้ง Windows service"
foreach ($svc in "CruiseBingo","CruiseBingoCaddy") {
  if (Get-Service $svc -ErrorAction SilentlyContinue) { & $NssmExe stop $svc | Out-Null; & $NssmExe remove $svc confirm | Out-Null }
}

& $NssmExe install CruiseBingo $NodeExe "server.js" | Out-Null
& $NssmExe set CruiseBingo AppDirectory $AppDir | Out-Null
& $NssmExe set CruiseBingo AppEnvironmentExtra "PORT=$Port" "HOST=127.0.0.1" "NODE_ENV=production" | Out-Null
& $NssmExe set CruiseBingo Start SERVICE_AUTO_START | Out-Null
& $NssmExe set CruiseBingo AppStdout "$AppDir\logs\app.out.log" | Out-Null
& $NssmExe set CruiseBingo AppStderr "$AppDir\logs\app.err.log" | Out-Null

& $NssmExe install CruiseBingoCaddy $CaddyExe "run --config `"$CaddyDir\Caddyfile`" --adapter caddyfile" | Out-Null
& $NssmExe set CruiseBingoCaddy AppDirectory $CaddyDir | Out-Null
& $NssmExe set CruiseBingoCaddy Start SERVICE_AUTO_START | Out-Null
& $NssmExe set CruiseBingoCaddy AppStdout "$CaddyDir\caddy.out.log" | Out-Null
& $NssmExe set CruiseBingoCaddy AppStderr "$CaddyDir\caddy.err.log" | Out-Null

# --- 9. ไฟร์วอลล์ ---
Say "เปิดไฟร์วอลล์ 80/443"
foreach ($p in 80,443) {
  if (-not (Get-NetFirewallRule -DisplayName "Cruise Bingo $p" -ErrorAction SilentlyContinue)) {
    New-NetFirewallRule -DisplayName "Cruise Bingo $p" -Direction Inbound -Action Allow -Protocol TCP -LocalPort $p | Out-Null
  }
}

# --- 10. start ---
Say "เริ่ม service"
& $NssmExe start CruiseBingo | Out-Null
Start-Sleep -Seconds 2
& $NssmExe start CruiseBingoCaddy | Out-Null
Start-Sleep -Seconds 3

Write-Host "`n======================================================" -ForegroundColor Green
Write-Host " เสร็จแล้ว!" -ForegroundColor Green
Write-Host " เปิด:  https://$Domain" -ForegroundColor Green
Write-Host "======================================================`n" -ForegroundColor Green
Write-Host "สถานะ service:"
Get-Service CruiseBingo, CruiseBingoCaddy | Format-Table -AutoSize
Write-Host "ถ้าเว็บยังไม่ขึ้น รอ Caddy ขอใบรับรอง 10-60 วิ แล้วลองใหม่ หรือดู log:"
Write-Host "  Get-Content $AppDir\logs\app.err.log -Tail 40"
Write-Host "  Get-Content $CaddyDir\caddy.err.log -Tail 40"
Write-Host "`nหมายเหตุ: ถ้า hostatom มีไฟร์วอลล์ภายนอก ต้องเปิด inbound 80/443 ที่ control panel ด้วย"
