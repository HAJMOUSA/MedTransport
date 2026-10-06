# MidTransport — Production Setup & Go‑Live Runbook

A step‑by‑step "what to do" checklist to take MidTransport from the current test
deployment to a proper production environment under its own AWS account.

Work through the items **in order**. Each box is a task you can tick off.

> **Where things stand today (Oct 2026):**
> - A **test** instance is running on a *personal* AWS account: AWS Lightsail
>   `midtransport-test` → `3.234.108.64` → <https://midtransport.hajmousa.com>
>   (HTTPS via Caddy). Demo data + test logins are documented in
>   `docs/testing/real-world-testing-guide.md`.
> - **Goal:** stand up the production system under a dedicated AWS account
>   (**MidTransportApp**), with its own domain, secrets, SMS/email, and backups.
> - Deployment mechanics are already written up in `deploy/DEPLOY.md` (HTTPS +
>   domain) and `deploy/AWS-LIGHTSAIL.md` (quick HTTP/IP). This runbook is the
>   ordered plan that ties them together; it points to those where relevant.

---

## Item 1 — Configure the AWS account "MidTransportApp"

You've created the Outlook mailbox **`MidTransportApp@outlook.com`** — that will
be the AWS **root account email**. This item sets the account up safely so it's
ready to host production resources.

### 1.1 Create / claim the AWS account
- [ ] Go to <https://signup.aws.amazon.com/>.
- [ ] **Root email:** `MidTransportApp@outlook.com`  •  **Account name:**
      `MidTransportApp`.
- [ ] Set a **strong, unique root password** and store it in a password manager
      (not in this repo, not in email).
- [ ] Provide billing contact + a **payment card**, and complete phone
      verification.
- [ ] Choose the **Basic (free) Support** plan unless you need more.

### 1.2 Lock down the root user (do this immediately)
- [ ] Sign in as **root** → **IAM → enable MFA** on the root user (authenticator
      app such as Microsoft/Google Authenticator, or a hardware key).
- [ ] Confirm there are **no root access keys** (IAM → root user → Access keys →
      delete any that exist). Root is for emergencies only — never for daily work
      or automation.
- [ ] Record the recovery details (root email inbox access + MFA backup codes) in
      the password manager.

### 1.3 Billing & cost controls
- [ ] **Account → IAM user and role access to Billing**: turn **ON** (lets admin
      IAM users see billing without root).
- [ ] **Billing → Budgets → Create budget**: a monthly cost budget (e.g. \$30–50)
      with an **email alert** to `MidTransportApp@outlook.com` at 50 % / 80 % /
      100 %.
- [ ] (Optional) **Billing preferences:** enable "Receive Free Tier usage alerts"
      and "Receive Billing alerts".

### 1.4 Create an everyday admin user (don't use root day‑to‑day)
- [ ] **IAM → Users → Create user**: name `mt-admin` (or your name).
- [ ] Attach the **AdministratorAccess** policy (or a scoped policy later).
- [ ] Enable **console access** with a strong password + **MFA**.
- [ ] If you'll use the AWS CLI / scripts, create an **access key** for this user
      and store it securely (see 1.6). Prefer a dedicated deploy user with only
      the permissions it needs once things settle.

### 1.5 Pick the region
- [ ] Standardize on **`us-east-1` (N. Virginia)** — it matches the current test
      box and keeps latency low for US East riders. Create all production
      resources there unless you have a reason not to.

### 1.6 (Optional) wire up the AWS CLI locally
- [ ] Install AWS CLI v2, then `aws configure --profile midtransportapp` and paste
      the `mt-admin` access key + region `us-east-1`.
- [ ] Verify: `aws sts get-caller-identity --profile midtransportapp` shows the
      **MidTransportApp** account id (not the personal one).

**✅ Item 1 done when:** you can sign in to the MidTransportApp account as an
MFA‑protected admin IAM user, root is MFA‑locked with no access keys, and a
billing budget alert is active.

---

## Item 2 — Provision the production server

- [ ] In the **MidTransportApp** account, create a **Lightsail** instance:
      Ubuntu 24.04 LTS, **2 GB RAM / 2 vCPU** (the $12/mo plan — smaller plans can
      run out of memory during the build), in **us-east-1**.
- [ ] Attach a **static IP** (Networking tab) so the address survives reboots.
- [ ] Firewall (Networking → IPv4): allow **22 (SSH)**, **80**, **443**. Leave
      everything else closed (Postgres/Redis/API stay inside Docker).
- [ ] Add a **2 GB swap file** and install Docker — see the exact commands in
      `deploy/AWS-LIGHTSAIL.md` §3.

**Reference:** `deploy/DEPLOY.md` (full HTTPS runbook) and
`deploy/AWS-LIGHTSAIL.md` (quick start).

---

## Item 3 — Domain & HTTPS

- [ ] Decide the production hostname (e.g. `app.midtransport.com` or keep a
      `*.hajmousa.com` subdomain for now).
- [ ] Create a **DNS A record** → the Lightsail **static IP**.
- [ ] Caddy (in `docker-compose.prod.yml`) will fetch + auto‑renew the Let's
      Encrypt TLS certificate once DNS resolves. HTTPS is **required** for driver
      GPS + camera to work in the field.

---

## Item 4 — Environment secrets (`.env`)

- [ ] On the server, `cp .env.production.example .env` and fill it in.
- [ ] Generate each secret with `openssl rand -base64 48`:
      `POSTGRES_PASSWORD`, `REDIS_PASSWORD`, `JWT_SECRET`, `JWT_REFRESH_SECRET`.
- [ ] Set `DOMAIN` and `APP_BASE_URL=https://<your-domain>`, `ORG_NAME`,
      `ORG_TIMEZONE` (e.g. `America/New_York`), `GEOFENCE_ARRIVAL_RADIUS_M=100`.
- [ ] **Never commit `.env`.** Keep a copy of the secrets in the password manager.

---

## Item 5 — Messaging: SMS (Twilio) & email (SendGrid)

Currently **blank** on the test box, which is why rider OTP texts don't send
(drivers use the photo fallback). For production:

- [ ] **Twilio:** create an account, buy a phone number, then set
      `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_PHONE_NUMBER` in `.env`.
      This enables the 6‑digit arrival codes texted to riders.
- [ ] **SendGrid (optional, for email):** set `SENDGRID_API_KEY`,
      `SENDGRID_FROM_EMAIL`, `SENDGRID_FROM_NAME`.
- [ ] Restart the API after changing `.env` (see Item 6) and send a test trip to
      confirm a real SMS arrives.

> Until Twilio is set, OTP codes are written to the API logs
> (`docker compose logs api | grep -i otp`) — fine for internal testing only.

---

## Item 6 — Deploy the application

- [ ] On the server: `git clone` the repo (or `git pull` if already cloned) and
      check out the release branch.
- [ ] Launch with the production compose (Caddy + HTTPS):
      ```bash
      docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d --build
      ```
- [ ] The API runs database migrations automatically on every start
      (idempotent). Watch TLS issuance: `... logs -f caddy`.
- [ ] To ship an update later: `git pull` then
      `... up -d --build api web`.

---

## Item 7 — First‑run admin & data

- [ ] Open `https://<your-domain>` and sign in with the seeded admin
      (`admin@example.com` / `Admin1234!`).
- [ ] **Change the admin password immediately** (Settings → Change Password).
- [ ] Create real **dispatcher** and **driver** accounts (Admin → Drivers).
- [ ] Import your **riders** and **trips** via CSV — see the import instructions
      in `docs/testing/real-world-testing-guide.md`.

---

## Item 8 — Driver mobile app

- [ ] Build the production APK pointing at the production URL:
      ```powershell
      cd apps\mobile
      ./scripts/build-apk.ps1 -ApiUrl https://<your-domain>
      ```
      (or use EAS Build — see `apps/mobile/eas.json`).
- [ ] Host the `.apk` (Google Drive / MDM) and share the install link with
      drivers. Android only for now; it is side‑loaded (not on the Play Store).
- [ ] For an eventual Play Store release, build an **app bundle** (`eas.json`
      `production` profile) and set up a Play Console account.

---

## Item 9 — Backups, monitoring & operations

- [ ] **Database backups:** schedule a daily `pg_dump` (see `deploy/DEPLOY.md`
      "Operations cheatsheet") and copy the dump **off the server** (e.g. to S3 in
      the MidTransportApp account).
- [ ] **Snapshots:** enable automatic **Lightsail snapshots** of the instance.
- [ ] **Uptime check:** add a free uptime monitor hitting `/api/health`.
- [ ] Know the log commands: `docker compose ... logs -f api` /
      `... logs -f caddy`.

---

## Item 10 — Security checklist (before real riders)

- [ ] Default admin password changed; unused seeded accounts removed.
- [ ] `.env` holds generated secrets (not the example placeholders).
- [ ] Only ports **22 / 80 / 443** open on the Lightsail firewall.
- [ ] Root AWS user MFA‑enabled with no access keys; daily work via IAM user.
- [ ] Backups running **and** restore tested at least once.
- [ ] Twilio live (or riders explicitly told codes are off and photo fallback is
      used).

---

## Appendix — current test environment (for reference)

| Thing | Value |
|-------|-------|
| Test URL | <https://midtransport.hajmousa.com> |
| Test server | AWS Lightsail `midtransport-test`, IP `3.234.108.64`, user `ubuntu`, region us-east-1 |
| Repo on server | `~/MedTransport` |
| Compose (prod/HTTPS) | `docker compose -f docker-compose.yml -f docker-compose.prod.yml ...` |
| Git remote | `github.com/HAJMOUSA/MedTransport.git` |
| Test logins | see `docs/testing/real-world-testing-guide.md` |

> Note: the test instance currently lives in a **personal** AWS account. When the
> MidTransportApp account and production server are ready (Items 1–6), migrate
> DNS to the new instance and retire the test box (or keep it as staging).

---

*Related docs:* `deploy/DEPLOY.md`, `deploy/AWS-LIGHTSAIL.md`,
`docs/testing/real-world-testing-guide.md`.
