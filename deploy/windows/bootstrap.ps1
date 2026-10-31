<#
  Cruise Bingo - all-in-one installer for Windows Server.
  Installs: Node + Caddy + app code, runs both as Scheduled Tasks (SYSTEM,
  at startup, auto-restart), opens the firewall, and gets automatic HTTPS.
  No NSSM needed - uses the built-in Task Scheduler.

  Usage (open PowerShell as Administrator, paste one line):

    Set-ExecutionPolicy Bypass -Scope Process -Force; `
    [Net.ServicePointManager]::SecurityProtocol=[Net.SecurityProtocolType]::Tls12; `
    iwr https://raw.githubusercontent.com/tinnachais/bingo/<SHA>/deploy/windows/bootstrap.ps1 -OutFile $env:TEMP\bootstrap.ps1; `
    & $env:TEMP\bootstrap.ps1

  Safe to re-run (idempotent): existing tasks are removed and recreated.
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

# --- 0. must be Administrator ---
$admin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $admin) { throw "Please run PowerShell as Administrator" }

$NodeDir  = Join-Path $ToolsDir "node"
$CaddyDir = Join-Path $ToolsDir "caddy"
$CaddyExe = Join-Path $CaddyDir "caddy.exe"
New-Item -ItemType Directory -Force -Path $ToolsDir, (Split-Path $AppDir) | Out-Null

# --- 1. DNS check (warn if not pointing here yet) ---
Say "Checking DNS for $Domain"
try {
  $myip = (Invoke-RestMethod "https://api.ipify.org?format=text")
  $dns  = (Resolve-DnsName $Domain -Type A -ErrorAction Stop | Where-Object {$_.IPAddress} | Select-Object -First 1).IPAddress
  Write-Host "   This machine public IP: $myip"
  Write-Host "   $Domain resolves to    : $dns"
  if ($dns -ne $myip) { Warn "DNS does not point to this machine yet - Caddy cannot get an HTTPS certificate until the A record for $Domain points to $myip" }
  else { Write-Host "   DNS OK" -ForegroundColor Green }
} catch { Warn "DNS check failed: $($_.Exception.Message) - verify $Domain points to this machine" }

# --- 2. Node.js (portable zip) ---
if (Test-Path (Join-Path $NodeDir "node.exe")) {
  Say "Node already present at $NodeDir"
} else {
  Say "Downloading Node.js v$NodeVer"
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

# --- 3. Caddy (from GitHub releases) ---
if (Test-Path $CaddyExe) {
  Say "Caddy already present"
} else {
  Say "Downloading Caddy v$CaddyVer"
  $cz = "$env:TEMP\caddy.zip"
  Invoke-WebRequest "https://github.com/caddyserver/caddy/releases/download/v$CaddyVer/caddy_${CaddyVer}_windows_amd64.zip" -OutFile $cz
  Expand-Archive $cz -DestinationPath "$env:TEMP\caddy_x" -Force
  New-Item -ItemType Directory -Force -Path $CaddyDir | Out-Null
  Copy-Item "$env:TEMP\caddy_x\caddy.exe" $CaddyExe -Force
}

# --- 4. Fetch app code ---
Say "Fetching app code (branch $Branch)"
$az = "$env:TEMP\bingo.zip"
$branchFile = $Branch.Replace('/','-')
Invoke-WebRequest "https://github.com/tinnachais/bingo/archive/refs/heads/$Branch.zip" -OutFile $az
Expand-Archive $az -DestinationPath "$env:TEMP\bingo_x" -Force
$srcApp = Join-Path "$env:TEMP\bingo_x" "bingo-$branchFile"
if (Test-Path $AppDir) { Remove-Item $AppDir -Recurse -Force }
Move-Item $srcApp $AppDir
New-Item -ItemType Directory -Force -Path (Join-Path $AppDir "logs") | Out-Null

# --- 5. npm ci ---
Say "Installing dependencies (npm ci)"
Push-Location $AppDir
& $NpmCmd ci --omit=dev
Pop-Location

# --- 6. Write Caddyfile ---
Say "Writing Caddyfile for $Domain"
@"
$Domain {
	encode zstd gzip
	reverse_proxy 127.0.0.1:$Port
}
"@ | Set-Content -Path (Join-Path $CaddyDir "Caddyfile") -Encoding UTF8

# --- 7. Write launcher .cmd wrappers (set env, cwd, logging) ---
Say "Writing launchers"
$bingoCmd = Join-Path $AppDir "run-bingo.cmd"
@"
@echo off
cd /d "$AppDir"
set PORT=$Port
set HOST=127.0.0.1
set NODE_ENV=production
"$NodeExe" server.js >> "$AppDir\logs\app.out.log" 2>>&1
"@ | Set-Content -Path $bingoCmd -Encoding ASCII

$caddyCmd = Join-Path $CaddyDir "run-caddy.cmd"
@"
@echo off
cd /d "$CaddyDir"
"$CaddyExe" run --config "$CaddyDir\Caddyfile" --adapter caddyfile >> "$CaddyDir\caddy.out.log" 2>>&1
"@ | Set-Content -Path $caddyCmd -Encoding ASCII

# --- 8. Register Scheduled Tasks (SYSTEM, at startup, auto-restart) ---
Say "Registering startup tasks"
function Register-BingoTask($name, $cmd, $workdir) {
  Unregister-ScheduledTask -TaskName $name -Confirm:$false -ErrorAction SilentlyContinue
  $action    = New-ScheduledTaskAction -Execute $cmd -WorkingDirectory $workdir
  $trigger   = New-ScheduledTaskTrigger -AtStartup
  $principal = New-ScheduledTaskPrincipal -UserId "SYSTEM" -LogonType ServiceAccount -RunLevel Highest
  $settings  = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable -RestartCount 5 -RestartInterval (New-TimeSpan -Minutes 1) -ExecutionTimeLimit ([TimeSpan]::Zero) -MultipleInstances IgnoreNew
  Register-ScheduledTask -TaskName $name -Action $action -Trigger $trigger -Principal $principal -Settings $settings | Out-Null
  Start-ScheduledTask -TaskName $name
}
Register-BingoTask "CruiseBingo"      $bingoCmd $AppDir
Register-BingoTask "CruiseBingoCaddy" $caddyCmd $CaddyDir

# --- 9. Firewall ---
Say "Opening firewall ports 80/443"
foreach ($p in 80,443) {
  if (-not (Get-NetFirewallRule -DisplayName "Cruise Bingo $p" -ErrorAction SilentlyContinue)) {
    New-NetFirewallRule -DisplayName "Cruise Bingo $p" -Direction Inbound -Action Allow -Protocol TCP -LocalPort $p | Out-Null
  }
}

# --- 10. Verify ---
Start-Sleep -Seconds 4
Say "Verifying"
$listening = $false
try { $listening = (Test-NetConnection -ComputerName 127.0.0.1 -Port $Port -WarningAction SilentlyContinue).TcpTestSucceeded } catch {}
if ($listening) { Write-Host "   Node app is listening on 127.0.0.1:$Port" -ForegroundColor Green }
else { Warn "Node app not listening yet on port $Port - check $AppDir\logs\app.out.log" }

Write-Host "`n======================================================" -ForegroundColor Green
Write-Host " DONE!" -ForegroundColor Green
Write-Host " Open:  https://$Domain" -ForegroundColor Green
Write-Host "======================================================`n" -ForegroundColor Green
Write-Host "Task status:"
Get-ScheduledTask CruiseBingo, CruiseBingoCaddy | Select-Object TaskName, State | Format-Table -AutoSize
Write-Host "If the site is not up yet, wait 10-60s for Caddy to get a certificate, then retry. Logs:"
Write-Host "  Get-Content $AppDir\logs\app.out.log -Tail 40"
Write-Host "  Get-Content $CaddyDir\caddy.out.log -Tail 40"
Write-Host "`nManage:  Start-ScheduledTask CruiseBingo | Stop-ScheduledTask CruiseBingo"
Write-Host "Note: if hostatom has an external firewall, also open inbound 80/443 in its control panel."
