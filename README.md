# MidTransport

**Open-source, privacy-first Non-Emergency Medical Transportation (NEMT) platform.**

Built for small providers (1–20 vehicles) who serve sick and elderly patients — and who are tired of cloud software sharing their data with competitors.

---

## Why MidTransport?

Every other NEMT platform is a closed SaaS cloud product. Your rider data lives on their servers, accessible to their staff, and potentially visible across their customer base. Providers in smaller markets have already said they're shying away from these tools because of this.

MidTransport is different:

| Feature | MidTransport | Competitors |
|---|---|---|
| Self-hostable | ✅ Your server | ❌ Cloud only |
| Open-source | ✅ MIT license | ❌ Closed SaaS |
| Medical records stored | ❌ Never | ⚠️ Often required |
| Real-time driver GPS tracking | ✅ Built-in | ⚠️ Paid add-on |
| Smart OTP trip verification | ✅ Built-in | ⚠️ Paper or tablet |
| Per-trip fees | ❌ None | ⚠️ Common |
| Free to run | ✅ Self-hosted | ❌ |

---

## Key Features (MVP)

### 🔒 Privacy by Design
- Stores only rider contact info: name, phone, address, emergency contact
- No medical records, no diagnosis, no insurance numbers
- All data stays on your server — nothing leaves your infrastructure

### 🗺️ Real-Time Driver Tracking
- Live dispatcher map shows all driver locations in real time
- Geofence auto-arrival detection (marks "Arrived" at 100m from destination)
- Driver metrics: speed, idle time, on-time rate, trips completed
- Route history replay for any trip

### 📱 Smart OTP Verification
- Replaces paper signature at pickup and dropoff
- When driver arrives: rider receives a 6-digit SMS code
- Driver enters code in app → GPS + timestamp + OTP hash logged
- Creates tamper-proof audit trail for Medicaid billing
- Fallback: timestamped photo if rider has no phone

### 📋 Multiple Data Entry Methods
- Manual trip entry form
- CSV bulk import (drag-and-drop, column mapping, duplicate detection)
- Broker API integration (Phase 2: ModivCare, MTM)

### 📊 Dispatcher Dashboard
- Live trip board (kanban by status)
- Live map with driver pins, pickup/dropoff markers
- Driver detail panel (click any driver → see metrics)
- Search, filter, assign, and reassign trips

### 🚗 Driver Mobile App (PWA + React Native)
- Today's trips list
- One-tap navigation (opens Google Maps / Apple Maps)
- ARRIVED button → triggers OTP flow
- OTP entry screen
- Works on any Android or iPhone browser (PWA) or as native app

---

## Status

> **Phase 1 MVP — Active Development** (March 2026)

See [PROPOSAL.md](./PROPOSAL.md) for the full research report including:
- Market analysis ($4.4–6.6B US market)
- Competitive analysis of 10 NEMT platforms
- Broker API integrations
- Tech stack decisions
- UI/UX wireframes
- 3-phase implementation roadmap

---

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend | React 18 + TypeScript + TailwindCSS + shadcn/ui |
| Mobile | React Native (Expo) |
| Backend | Node.js + Express + TypeScript |
| Database | PostgreSQL + PostGIS |
| Cache / Sessions | Redis |
| Real-time (GPS) | Socket.io |
| Maps | Leaflet + OpenStreetMap (free) |
| SMS (OTP) | Twilio |
| Deployment | Docker + Docker Compose |

---

## Getting Started (Self-Hosted)

```bash
git clone https://github.com/your-org/midtransport
cd midtransport
cp .env.example .env
# Edit .env: add your database password + Twilio credentials
docker-compose up -d
```

Open **http://localhost:3000** → Create your admin account → Start dispatching.

**Minimum server:** 2 vCPU, 4GB RAM (~$10/month on Hetzner or DigitalOcean)

---

## License

MIT — free to use, modify, and deploy.
