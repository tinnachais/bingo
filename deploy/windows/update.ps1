# อัปเดตโค้ดเวอร์ชันใหม่แล้วรีสตาร์ต service
# Run as Administrator:  powershell -ExecutionPolicy Bypass -File .\update.ps1
param([string]$AppDir = "C:\apps\cruise-bingo")
$ErrorActionPreference = "Stop"
Set-Location $AppDir
git pull
npm ci --omit=dev
Restart-Service CruiseBingo
Write-Host "อัปเดตเสร็จ — รีสตาร์ต CruiseBingo แล้ว (ห้องที่กำลังเล่นจะหาย)"
