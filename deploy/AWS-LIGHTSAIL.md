# MidTransport — AWS Lightsail Test Deploy (HTTP, IP-only)

Fastest way to get a shareable test instance running on AWS with **no domain and
no TLS** — just `http://<SERVER_IP>:3000`. Your existing `docker-compose.yml`
runs unchanged (the web container's nginx proxies `/api` and `/socket.io`
internally, so there is no CORS or API-URL to configure).

> For a real HTTPS release with a domain, use `deploy/DEPLOY.md` instead.

---

## 1. Create the Lightsail instance (~5 min, AWS console)

1. Go to **Lightsail → Create instance**.
2. Region: closest to your testers.
3. Platform: **Linux/Unix** → Blueprint: **OS Only → Ubuntu 24.04 LTS**.
4. Plan: **2 GB RAM / 2 vCPU** (the $12/mo plan; smaller plans can OOM during the
   image build). First 3 months are free.
5. Name it `midtransport-test` → **Create instance**.
6. Open the instance → **Networking** tab → attach a **Static IP** (free while
   attached) so the address doesn't change on reboot. This is your `SERVER_IP`.
7. Still on **Networking → IPv4 Firewall**, add a rule:
   - **Custom / TCP / 3000** (the web app)
   - SSH (22) is already open. Leave everything else closed — Postgres/Redis/API
     are never exposed by the Lightsail firewall.

## 2. Connect to the server

Use the browser SSH ("Connect using SSH" button) or your own terminal:

```bash
ssh ubuntu@SERVER_IP        # if using your own key uploaded to Lightsail
```

## 3. Install Docker + a swap file (paste as-is)

The 2 GB plan builds fine with a little swap headroom:

```bash
# Docker
curl -fsSL https://get.docker.com | sudo bash
sudo usermod -aG docker $USER

# 2 GB swap (safety margin for the vite/tsc build)
sudo fallocate -l 2G /swapfile && sudo chmod 600 /swapfile
sudo mkswap /swapfile && sudo swapon /swapfile
echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab

# apply the docker group without a full logout:
exec sg docker newgrp `id -gn`
```

## 4. Get the code

The repo is public, so just clone the branch with the latest work:

```bash
git clone -b trip-import https://github.com/HAJMOUSA/MedTransport.git
cd MedTransport
```

## 5. Create the `.env`

```bash
cp .env.production.example .env
nano .env
```

Set these (leave Twilio/SendGrid blank for the test — OTP codes will appear in
the API logs):

```dotenv
POSTGRES_PASSWORD=<paste generated secret>
REDIS_PASSWORD=<paste generated secret>
JWT_SECRET=<paste generated secret>
JWT_REFRESH_SECRET=<paste generated secret>

VITE_API_URL=""
APP_BASE_URL=http://SERVER_IP:3000     # <-- your real IP
ORG_NAME=Your Transport Company
ORG_TIMEZONE=America/New_York
```

`DOMAIN` is unused on the HTTP path — you can ignore it.

## 6. Launch

Use the **base** compose file only (no `-prod` / Caddy):

```bash
docker compose up -d --build          # first build takes a few minutes
docker compose ps                     # all services healthy?
docker compose logs -f api            # watch startup / find OTP codes later
```

Open **http://SERVER_IP:3000** → log in with the seeded admin
(`admin@example.com` / `Admin1234!`) → **change the password immediately**.

## 7. Operations cheatsheet

```bash
docker compose logs -f api                 # API logs
docker compose logs api | grep -i otp      # OTP codes (Twilio blank = dev-SMS)
docker compose exec db pg_dump -U midtransport midtransport | gzip > backup-$(date +%F).sql.gz
git pull && docker compose up -d --build   # deploy an update
docker compose down                        # stop (data persists in volumes)
```

## Notes / hardening for later

- **HTTP only**: browser geolocation and camera (driver GPS + OTP photo) are
  restricted on non-HTTPS origins in some browsers. Fine for desktop dispatcher
  testing; for real driver-phone testing, switch to the HTTPS path in
  `deploy/DEPLOY.md` (Caddy + a free DuckDNS domain).
- The base compose publishes 5432/6379 on the host, but the Lightsail firewall
  blocks them externally since only 22 and 3000 are open. Keep it that way.
- Twilio blank is intentional for testing. Fill it in when you want real SMS.
