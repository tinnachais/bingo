# Deploy Cruise Bingo บน Windows Server → bingo.pssgroup.app

รันแอปเป็น **Windows service** ด้วย NSSM และใช้ **Caddy** เป็น reverse proxy
(Caddy ขอใบรับรอง HTTPS ให้อัตโนมัติ + ผ่าน WebSocket ให้เองโดยไม่ต้องตั้งค่า)

> ทุกขั้นตอนรันหลัง **RDP เข้าเครื่อง** และเปิด **PowerShell แบบ Run as Administrator**

---

## 0. เช็กก่อนเริ่ม

**DNS** — `bingo.pssgroup.app` ต้องชี้มาที่ IP เครื่องนี้ (27.254.143.237)
```powershell
Resolve-DnsName bingo.pssgroup.app
```
ต้องได้ IP ของเครื่อง ถ้ายังไม่ชี้ ให้ไปตั้ง A record ที่ผู้ให้บริการ DNS ก่อน

**พอร์ต 80/443 ต้องว่าง** — ถ้ามี IIS หรือเว็บเซิร์ฟเวอร์อื่นจับพอร์ตนี้อยู่ Caddy จะเริ่มไม่ได้
```powershell
netstat -ano | findstr ":80 "
netstat -ano | findstr ":443 "
```
ถ้ามี IIS ใช้ 80/443 อยู่ เลือกทางใดทางหนึ่ง:
- หยุด/ปิด IIS:  `Stop-Service W3SVC; Set-Service W3SVC -StartupType Disabled`
- หรือใช้ IIS เป็น reverse proxy แทน Caddy (ดูภาคผนวกท้ายไฟล์)

---

## 1. ติดตั้ง Node.js

ถ้ายังไม่มี node (`node -v` ไม่ขึ้น) ติดตั้งผ่าน winget:
```powershell
winget install OpenJS.NodeJS.LTS
```
หรือดาวน์โหลด installer จาก https://nodejs.org (เลือก LTS) แล้วติดตั้ง
ปิด-เปิด PowerShell ใหม่ แล้วเช็ก `node -v` (ต้อง v18 ขึ้นไป)

---

## 2. ดึงโค้ดแอป

วางไว้ที่ `C:\apps\cruise-bingo`

**ถ้ามี git:**
```powershell
git clone https://github.com/tinnachais/bingo.git C:\apps\cruise-bingo
cd C:\apps\cruise-bingo
git checkout claude/peaceful-gauss-0b70su   # หรือ main หลัง merge
```

**ถ้าไม่มี git** — ดาวน์โหลด ZIP:
```powershell
mkdir C:\apps
Invoke-WebRequest "https://github.com/tinnachais/bingo/archive/refs/heads/claude/peaceful-gauss-0b70su.zip" -OutFile "$env:TEMP\bingo.zip"
Expand-Archive "$env:TEMP\bingo.zip" -DestinationPath C:\apps
Rename-Item "C:\apps\bingo-claude-peaceful-gauss-0b70su" "cruise-bingo"
cd C:\apps\cruise-bingo
```

ติดตั้ง dependency (เฉพาะ ws):
```powershell
npm ci --omit=dev
```

ทดสอบรันเปล่าๆ ก่อน (Ctrl+C เพื่อหยุด):
```powershell
$env:PORT=3000; $env:HOST="127.0.0.1"; node server.js
# ควรเห็น: Cruise Bingo running on http://127.0.0.1:3000
```

---

## 3. ติดตั้ง NSSM (ตัวทำให้ node รันเป็น service)

```powershell
mkdir C:\tools\nssm -Force
Invoke-WebRequest "https://nssm.cc/release/nssm-2.24.zip" -OutFile "$env:TEMP\nssm.zip"
Expand-Archive "$env:TEMP\nssm.zip" -DestinationPath "$env:TEMP\nssm"
Copy-Item "$env:TEMP\nssm\nssm-2.24\win64\nssm.exe" C:\tools\nssm\nssm.exe
```

---

## 4. ติดตั้ง Caddy (reverse proxy + HTTPS อัตโนมัติ)

ดาวน์โหลด caddy.exe (Windows amd64) จาก https://caddyserver.com/download
หรือผ่าน winget:
```powershell
winget install CaddyServer.Caddy
```
ถ้าโหลดเอง ให้วาง `caddy.exe` ไว้ที่ `C:\tools\caddy\caddy.exe`

คัดลอก Caddyfile ของโปรเจกต์ไปไว้ข้างๆ caddy.exe:
```powershell
mkdir C:\tools\caddy -Force
Copy-Item C:\apps\cruise-bingo\deploy\windows\Caddyfile C:\tools\caddy\Caddyfile
```

---

## 5. ติดตั้งเป็น service ทั้งคู่ (สคริปต์เดียวจบ)

```powershell
cd C:\apps\cruise-bingo\deploy\windows
powershell -ExecutionPolicy Bypass -File .\install-service.ps1
```

สคริปต์จะ:
- สร้าง service **CruiseBingo** (node รันที่ 127.0.0.1:3000)
- สร้าง service **CruiseBingoCaddy** (reverse proxy + ขอ TLS)
- เปิดไฟร์วอลล์พอร์ต 80, 443
- เริ่มทั้งสอง service

เสร็จแล้วรอสัก 10–30 วิให้ Caddy ขอใบรับรอง แล้วเปิด **https://bingo.pssgroup.app**

---

## ตรวจสถานะ / ดู log

```powershell
Get-Service CruiseBingo, CruiseBingoCaddy
Get-Content C:\apps\cruise-bingo\logs\app.err.log -Tail 50
Get-Content C:\tools\caddy\caddy.err.log -Tail 50
```

## รีสตาร์ต / หยุด

```powershell
Restart-Service CruiseBingo
Restart-Service CruiseBingoCaddy
```

## อัปเดตเวอร์ชันใหม่

```powershell
cd C:\apps\cruise-bingo\deploy\windows
powershell -ExecutionPolicy Bypass -File .\update.ps1
```

## ถอนการติดตั้ง service

```powershell
C:\tools\nssm\nssm.exe remove CruiseBingo confirm
C:\tools\nssm\nssm.exe remove CruiseBingoCaddy confirm
```

---

## แก้ปัญหาที่เจอบ่อย

- **เปิดเว็บไม่ขึ้น / TLS ไม่มา** — ดู `caddy.err.log` ส่วนใหญ่คือ DNS ยังไม่ชี้มาเครื่องนี้
  หรือพอร์ต 80 ถูก IIS จับอยู่ (Let's Encrypt ต้องใช้ 80 ตอน verify)
- **WebSocket ไม่ต่อ** — กับ Caddy แทบไม่เจอเพราะผ่านให้อัตโนมัติ เช็กว่าเปิดด้วย
  `https://` (ไม่ใช่ http) เพราะหน้าเว็บจะใช้ `wss://` เมื่อเป็น https
- **service ไม่ start** — `Get-Content ...app.err.log` ดู error ของ node;
  ลองรัน `node server.js` มือเปล่าใน step 2 ว่าได้ไหม
- **ไฟร์วอลล์ผู้ให้บริการ (hostatom)** — บางที่มีไฟร์วอลล์ภายนอกอีกชั้น
  ต้องเปิด inbound 80/443 ที่หน้า control panel ของ hostatom ด้วย

---

## ภาคผนวก: ใช้ IIS แทน Caddy (ถ้า IIS ต้องรันอยู่แล้ว)

ถ้าเครื่องนี้มี IIS โฮสต์เว็บอื่นอยู่ และต้องแชร์พอร์ต 80/443 ให้ใช้ IIS เป็น
reverse proxy แทน:

1. ติดตั้ง **URL Rewrite** + **Application Request Routing (ARR)**
   (ผ่าน Web Platform Installer หรือ installer จากเว็บ Microsoft)
2. เปิด WebSocket feature ของ IIS:
   `Enable-WindowsOptionalFeature -Online -FeatureName IIS-WebSockets`
3. สร้าง site `bingo.pssgroup.app` ใน IIS, ขอ cert (win-acme / Certify The Web)
4. ใส่ URL Rewrite rule ชี้ไป `http://127.0.0.1:3000/{R:1}` และเปิด
   "reverse proxy" ใน ARR — ARR เวอร์ชันใหม่ส่งผ่าน WebSocket ได้
5. ยังคงใช้ service **CruiseBingo** (node) จาก step 5 แต่ **ไม่ต้องติดตั้ง Caddy**

> ถ้าต้องการ ผมเขียน `web.config` (URL Rewrite) สำหรับ IIS ให้ได้ บอกมาได้เลย
