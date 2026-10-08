# 12 — Deployment & Operations

## Compose files

| File | Use |
|---|---|
| `docker-compose.yml` | Base stack: `db` (PostGIS), `redis`, `api`, `web`. `web` publishes `:3000`. |
| `docker-compose.prod.yml` | Override adding **Caddy** (auto TLS) in front; `web` becomes internal, Caddy publishes `:80`/`:443`. |

- **HTTP / IP-only** (quick test): `docker compose up -d --build` → `http://<host>:3000`. Runbook: `deploy/AWS-LIGHTSAIL.md`.
- **HTTPS / domain** (production): `docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d --build` with `DOMAIN` set → `https://<domain>`. Runbook: `deploy/DEPLOY.md`. TLS config: `deploy/Caddyfile` (`{$DOMAIN}` → `reverse_proxy web:80`, WebSockets automatic).

Minimum server: 2 vCPU / 2–4 GB RAM (e.g. AWS Lightsail `small_3_0`, Hetzner CX22, DigitalOcean $6 droplet). A 2 GB box needs a swap file for the image build (the runbooks add one).

## Reference deployment (current live demo)

The live instance is on **AWS Lightsail** (see the project memory / `deploy/AWS-LIGHTSAIL.md`):

- Instance `midtransport-test`, Ubuntu 24.04, `small_3_0` (2 GB), region `us-east-1`, static IP.
- Domain `midtransport.hajmousa.com` (A record at Porkbun → static IP), TLS via Caddy (Let's Encrypt, auto-renew).
- Firewall: 22 / 80 / 443 only. Runs the **prod compose**.
- Provisioned via the AWS CLI (`aws lightsail ...`) — key pair, instance, static IP, `put-instance-public-ports`.

## First-time deploy (HTTPS path, summary)

1. Provision an Ubuntu 24.04 host; open 22/80/443; attach a static IP.
2. Point a DNS **A record** at the IP.
3. Install Docker: `curl -fsSL https://get.docker.com | sudo sh`.
4. `git clone` the repo; `cp .env.production.example .env` and fill it (generate secrets; set `DOMAIN` and `APP_BASE_URL=https://<domain>`).
5. `docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d --build`.
6. Watch Caddy obtain the cert: `... logs -f caddy`. Verify `https://<domain>` and `/api/health`.
7. Log in as the seeded admin and **change the password**.

## Deploying an update

```bash
ssh <user>@<host>
cd MedTransport
git pull
# HTTPS/prod:
sudo docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d --build
# or HTTP/IP:
sudo docker compose up -d --build
```

The API runs idempotent migrations on start, so additive schema changes apply automatically. Volumes persist data across rebuilds.

> Deploy gotcha: if untracked files were copied onto the server that later became tracked in git (as happened with `deploy/demo-*.sql`), `git pull` can complain about overwriting untracked files — remove the local copies first, then pull.

## Data & volumes

Named volumes (survive `up`/`down`, destroyed only by `docker compose down -v`):

| Volume | Contents |
|---|---|
| `db_data` | PostgreSQL data |
| `redis_data` | Redis AOF |
| `uploads_data` | API uploads (OTP fallback photos) |
| `caddy_data`, `caddy_config` | TLS certs/state (prod) |

## Backups

```bash
# Database dump (run on the host)
docker compose exec -T db pg_dump -U midtransport midtransport | gzip > backup-$(date +%F).sql.gz
# Copy off-server (do this regularly / via cron)
scp <user>@<host>:~/backup-*.sql.gz .
```

Restore into a fresh DB with `gunzip -c backup.sql.gz | docker compose exec -T db psql -U midtransport -d midtransport`.

## Operations cheatsheet

```bash
# Status / logs
sudo docker compose ps
sudo docker compose logs -f api
sudo docker compose logs api | grep -i otp        # OTP codes in dev-SMS mode

# Demo data
sudo docker compose exec -T db psql -U midtransport -d midtransport < deploy/demo-seed.sql       # (re)seed
sudo docker compose exec -T db psql -U midtransport -d midtransport < deploy/demo-teardown.sql   # remove

# Restart one service
sudo docker compose up -d --force-recreate api
```

## Monitoring & health

- `GET /api/health` returns `200 {status:'ok'}` when DB + Redis are reachable, else `503`. Point an uptime check at `https://<domain>/api/health`.
- Container health: `db` and `redis` have compose healthchecks; the API waits for them.

## Scaling notes

This is a single-node design (one API, one DB, one Redis) sized for a small provider. Scaling out would require: externalizing Postgres/Redis, sticky sessions or a Redis Socket.io adapter for multiple API instances, and object storage for uploads. Out of scope for the current target (1–20 vehicles).

## Tearing down billing (cloud test instances)

For Lightsail: `aws lightsail delete-instance --instance-name midtransport-test --region us-east-1` and `aws lightsail release-static-ip --static-ip-name midtransport-ip --region us-east-1`.
