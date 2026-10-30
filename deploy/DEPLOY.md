# Deploy Cruise Bingo to bingo.pssgroup.app (VPS + nginx)

คู่มือนี้ติดตั้งแอปบน VPS Linux (Ubuntu/Debian) รันด้วย systemd และวาง nginx
เป็น reverse proxy พร้อม TLS (Let's Encrypt)

## 0. สิ่งที่ต้องมีก่อน

- VPS ที่มี public IP, เปิดพอร์ต 80 และ 443
- DNS: ชี้ A record (และ AAAA ถ้ามี IPv6) ของ `bingo.pssgroup.app` มาที่ IP ของ VPS
  - ตรวจด้วย: `dig +short bingo.pssgroup.app` ต้องได้ IP ของเครื่อง
- ติดตั้ง Node.js 18+ : `node -v`
- ติดตั้ง nginx : `sudo apt install nginx`

## 1. ดึงโค้ดและติดตั้ง dependency

```bash
sudo mkdir -p /opt/cruise-bingo
sudo chown "$USER" /opt/cruise-bingo
git clone https://github.com/tinnachais/bingo.git /opt/cruise-bingo
cd /opt/cruise-bingo
git checkout claude/peaceful-gauss-0b70su   # หรือ main หลัง merge
npm ci --omit=dev                            # ติดตั้งเฉพาะ ws
```

ให้สิทธิ์ให้ user ที่ service จะรัน (ไฟล์ service ใช้ `www-data`):

```bash
sudo chown -R www-data:www-data /opt/cruise-bingo
```

## 2. รันเป็น systemd service

```bash
sudo cp /opt/cruise-bingo/deploy/cruise-bingo.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now cruise-bingo
sudo systemctl status cruise-bingo      # ควรเห็น active (running)
```

service รัน Node ที่ `127.0.0.1:3000` (ตั้งผ่าน env `HOST`/`PORT` ในไฟล์ service)
ดู log ด้วย:

```bash
journalctl -u cruise-bingo -f
```

## 3. ตั้งค่า nginx

```bash
sudo cp /opt/cruise-bingo/deploy/nginx-bingo.conf /etc/nginx/conf.d/bingo.pssgroup.app.conf
sudo nginx -t
sudo systemctl reload nginx
```

ทดสอบผ่าน HTTP ก่อน (ยังไม่มี TLS): เปิด `http://bingo.pssgroup.app` ควรเห็นหน้าแรก

## 4. เปิด HTTPS ด้วย Let's Encrypt

```bash
sudo apt install certbot python3-certbot-nginx
sudo certbot --nginx -d bingo.pssgroup.app
```

certbot จะแก้ไฟล์ nginx ให้เพิ่ม block `listen 443 ssl` และ redirect 80 → 443 ให้อัตโนมัติ
เสร็จแล้วเปิด **https://bingo.pssgroup.app** ได้เลย — ฝั่งเว็บจะใช้ `wss://` อัตโนมัติ
(โค้ดเลือก `wss` เมื่อหน้าเพจเป็น https)

การต่ออายุใบรับรองเป็นอัตโนมัติผ่าน systemd timer ของ certbot (ตรวจด้วย
`systemctl list-timers | grep certbot`)

## 5. อัปเดตเวอร์ชันใหม่ภายหลัง

```bash
cd /opt/cruise-bingo
sudo -u www-data git pull
sudo -u www-data npm ci --omit=dev
sudo systemctl restart cruise-bingo
```

## ตรวจเช็กเวลา WebSocket ไม่ติด

- `sudo nginx -t` ผ่าน และไฟล์ conf มีบรรทัด `proxy_set_header Upgrade $http_upgrade;`
  กับ `Connection $connection_upgrade;` และมี `map $http_upgrade $connection_upgrade {...}`
- เปิด DevTools → Network → WS ต้องเห็น connection ไปที่ `wss://bingo.pssgroup.app/ws`
  สถานะ 101 Switching Protocols
- ถ้ามี Cloudflare หน้า VPS: เปิด WebSocket (เปิดโดยค่าเริ่มต้นอยู่แล้ว) และถ้าใช้ proxy
  (เมฆส้ม) ให้แน่ใจว่า SSL mode เป็น Full

## หมายเหตุ

- สถานะเกมอยู่ใน memory — ถ้า `systemctl restart` ห้องที่กำลังเล่นจะหาย
  ควร restart ตอนไม่มีคนเล่น
- ถ้าต้องการให้ Node ไม่รันด้วย `www-data` ก็เปลี่ยน `User=`/`Group=` ในไฟล์ service
  และ `chown` โฟลเดอร์ให้ตรงกัน
