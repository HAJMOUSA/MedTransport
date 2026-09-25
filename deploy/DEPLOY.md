# MidTransport — Production Release Runbook

Target: any Ubuntu 24.04 VPS (2 vCPU / 4 GB RAM minimum — e.g. Hetzner CX22).
Everything below assumes you run commands on the server as a sudo user, and on
your dev machine in the repo root.

---

## 1. Create the server (5 min)

1. Create a VPS: Ubuntu 24.04, 2 vCPU / 4 GB, in the region closest to your
   drivers. Note its public IP (`SERVER_IP`).
2. Firewall: allow inbound 22 (SSH), 80, 443. Everything else stays closed —
   Postgres/Redis/API stay inside the docker network.

## 2. Point DNS at the server

Create an **A record**: `your-domain` → `SERVER_IP`.
Free option: [duckdns.org](https://www.duckdns.org) subdomain, or your registrar.

Caddy (included in the production compose) fetches and renews the Let's Encrypt
certificate automatically once DNS resolves.

## 3. Install Docker on the server

```bash
ssh you@SERVER_IP
curl -fsSL https://get.docker.com | sudo bash
sudo usermod -aG docker $USER   # log out/in after this
```

## 4. Copy the deployment bundle to the server

On your dev machine (repo root):

```powershell
# 4a. Save the already-built images (avoids building on the small VPS)
docker save midtransport-api midtransport-web | gzip > mt-images.tar.gz

# 4b. Copy images + compose files + Caddy config to the server
scp mt-images.tar.gz docker-compose.yml docker-compose.prod.yml .env.production.example you@SERVER_IP:~/
scp -r deploy you@SERVER_IP:~/
```

On the server:

```bash
# 4c. Load the images
gunzip -c mt-images.tar.gz | docker load

# 4d. Create and fill the production env
cp .env.production.example .env
nano .env
#  - DOMAIN: your DNS name
#  - APP_BASE_URL: https://<same domain>
#  - passwords/secrets: generate each with: openssl rand -base64 48
```

## 5. Launch

```bash
docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d
docker compose -f docker-compose.yml -f docker-compose.prod.yml logs -f caddy   # watch TLS issuance
```

Open **https://your-domain** → log in with `admin@example.com` / `Admin1234!`
**and immediately change the password** (Settings → Change Password), then
delete or replace the seeded admin if you wish.

The API container runs `db:migrate` automatically on every start (idempotent).

## 6. Driver mobile app

Build the production APK pointing at the public URL:

```powershell
cd apps\mobile
$env:EXPO_PUBLIC_API_URL = "https://your-domain"
npx eas-cli build --platform android --profile production   # or `expo start` + set the env var for dev testing
```

(Requires a free Expo account for EAS Build. For quick testing, run
`expo start` with `EXPO_PUBLIC_API_URL` set and use Expo Go on the same
internet connection.)

## 7. Operations cheatsheet

```bash
# Status / logs
docker compose -f docker-compose.yml -f docker-compose.prod.yml ps
docker compose -f docker-compose.yml -f docker-compose.prod.yml logs -f api

# OTP codes while Twilio is blank (dev-SMS mode)
docker compose -f docker-compose.yml -f docker-compose.prod.yml logs api | grep -i otp

# Database backup
docker compose -f docker-compose.yml -f docker-compose.prod.yml exec db \
  pg_dump -U midtransport midtransport | gzip > backup-$(date +%F).sql.gz

# Update to a new release: repeat steps 4a–4c, then
docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d --force-recreate api web
```

## Security checklist

- [ ] Default admin password changed
- [ ] `.env` contains generated secrets (not the example placeholders)
- [ ] Only ports 22/80/443 open on the firewall
- [ ] Twilio blank until you are ready for real SMS
- [ ] Backups scheduled (cron + off-server copy)
