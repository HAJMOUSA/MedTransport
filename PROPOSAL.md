# MidTransport
## Open-Source, Privacy-First NEMT SaaS Platform
### Research & Build Proposal

> **Status:** MVP in active development
> **Prepared:** March 2026
> **Stack:** Node.js / TypeScript · React 18 · PostgreSQL + PostGIS · Redis · Docker
> **MVP Target:** Small NEMT provider (1–20 vehicles)

---

## Executive Summary

MidTransport is an open-source, self-hostable Non-Emergency Medical Transportation (NEMT) platform for small providers serving sick and elderly patients. Unlike every competing product on the market today, MidTransport stores all data locally — on the provider's own infrastructure — eliminating data sharing with competitors and addressing the #1 privacy concern raised by NEMT providers.

### Confirmed Core Differentiators
1. **Local-first / Self-hostable** — your data stays on your server
2. **Open-source (MIT)** — auditable, no vendor lock-in
3. **Privacy-by-minimization** — stores only contact info + trip details (no medical records); below full HIPAA PHI threshold
4. **Real-time driver GPS tracking** — live dispatcher map, geofencing, driver metrics, from Day 1
5. **Smart OTP verification** — 6-digit SMS code replaces paper signature at pickup & dropoff
6. **Multiple data entry methods** — manual entry, CSV upload, broker APIs (Phase 2)
7. **Accessible UI** — mobile-first for drivers, large-text for elderly patients
8. **No per-trip fees** — self-hosted is free; managed cloud is flat-rate

---

## 1. Market Opportunity

| Metric | Data |
|---|---|
| US NEMT Market Size (2025) | ~$4.4–6.6 billion |
| Projected US Market (2031) | ~$13.4 billion |
| CAGR | 7.1% – 9.7% |
| Medicaid share of NEMT trips | 52.34% |
| Largest player market share | < 5% (highly fragmented) |
| Fastest growing segment | Mental health transport (10.11% CAGR) |
| Healthcare data breaches (2023) | 809 breaches / 133M records exposed |
| HIPAA max fine | $1.5M/year per violation category |

**The Gap:** No dominant open-source, self-hostable NEMT platform exists. Every major competitor is a closed SaaS cloud product. Privacy concerns are rising. This is the market white space.

---

## 2. Competitive Analysis

### Top NEMT Software Platforms in the USA

| Product | Pricing | Key Strength | Key Weakness | Self-Hostable? |
|---|---|---|---|---|
| **MediRoutes** | Not public | Open API since 2008, broker integrations | Closed SaaS | No |
| **RouteGenie** | $50/vehicle/mo | Route optimization (-10–20% miles) | Complicated UI | No |
| **TripMaster** | From $125/mo | Scheduling automation, GPS | Basic route optimization | No |
| **Tobi Cloud** | Quote-based | Easy UI, digital attestation | Limited reporting | No |
| **NEMT Platform** | Not public | AI dispatch, broker API integrations | Closed SaaS | No |
| **Momentm Technologies** | Enterprise | 30yr expertise (Trapeze/TripSpark) | Enterprise pricing only | No |
| **Upper** | SaaS tiers | Good for small providers | NEMT features limited | No |
| **Ecolane** | Enterprise | Public transit + NEMT | Not NEMT-only | No |
| **Bambi NEMT** | SaaS | HIPAA-focused | Smaller ecosystem | No |
| **RydeWizz** | Free | Free tier available | Cloud-only, limited features | No |
| **MidTransport** | Free (self-host) | Privacy-first, open source, GPS+OTP built in | New — needs community | **Yes** |

### Privacy Concerns (Confirmed)
- All major platforms run shared cloud infrastructure
- Providers fear competitors can access their patient/rider lists
- BAAs required under HIPAA but inconsistently enforced
- 2023: Record 809 healthcare data breaches exposed 133M records
- HCPCS S0215 compliance requirement effective July 1, 2025

---

## 3. Data Privacy Strategy — No Medical Records

**What MidTransport stores (PII only):**
- Rider name, phone number, home address
- Emergency contact, mobility type (standard/wheelchair/stretcher)
- Dispatcher notes (operational, not medical)
- Trip origin/destination addresses, times, status

**What MidTransport intentionally does NOT store:**
- Diagnosis or medical conditions
- Medications or treatment plans
- Insurance/Medicaid/Medicare numbers
- Medical record numbers or provider IDs
- Health plan details

**HIPAA impact:** When a transportation app stores only name, phone, address, and destination (no health information) in a separate database from any health records, it does not have the same protected PHI status under HIPAA. If a customer bills Medicaid and becomes a covered entity, a BAA template is provided in `/docs`.

---

## 4. Available Broker APIs & Integrations

### Major NEMT Brokers (Trip Sources)

| Broker | Coverage | API Integration |
|---|---|---|
| **ModivCare** (formerly LogistiCare) | 30+ states | REST API · Phase 2 |
| **MTM Inc.** | All 50 states (post Access2Care) | MTM Link API · Phase 2 |
| **Kaiser Permanente** | West Coast | API · Phase 2 |
| **MAS (Medical Answering Services)** | Regional | REST API · Phase 2 |

**Phase 1 data entry:** CSV import + manual entry (works with all brokers immediately)

---

## 5. Feature Roadmap

### Phase 1 — MVP (Weeks 1–10) ✅ IN DEVELOPMENT

**Rider Management** *(contact info only)*
- [x] Create / edit / archive riders
- [ ] Fields: name, phone, home address, emergency contact, mobility type
- [ ] CSV bulk import with column mapping
- [ ] Duplicate detection

**Trip Scheduling**
- [ ] Manual trip entry
- [ ] CSV trip import
- [ ] Recurring trip templates
- [ ] Status flow: Scheduled → Dispatched → En Route → Arrived → Completed

**Driver Management**
- [ ] Driver profiles (name, phone, license, vehicle type)
- [ ] Shift scheduling
- [ ] Trip assignment

**Real-Time Driver GPS Tracking** *(Phase 1 feature)*
- [ ] Driver app broadcasts GPS every 10s via Socket.io
- [ ] Dispatcher live map: all drivers as moving pins (Leaflet + OSM)
- [ ] Geofence auto-arrival: marks "Arrived" when driver within 100m
- [ ] Driver metrics: speed, idle time, trips today, on-time rate
- [ ] Route breadcrumb replay

**Smart OTP Verification** *(Replaces paper signature)*
- [ ] Geofence entry triggers 6-digit SMS OTP to rider
- [ ] Driver enters OTP in app → GPS + timestamp + OTP hash logged
- [ ] Single-use, 10-minute expiry, tied to trip ID
- [ ] Fallback: photo capture if rider has no phone
- [ ] Audit trail suitable for Medicaid billing proof

**Dispatcher Dashboard (Web)**
- [ ] Live trip kanban board
- [ ] Live map with driver pins + geofences
- [ ] Driver detail panel (speed, heading, metrics)
- [ ] Trip assignment + CSV import

**Notifications**
- [ ] SMS: driver assignment + rider reminder + OTP
- [ ] Email: dispatcher alerts

**Reporting**
- [ ] Trips, utilization, on-time rate, OTP verification rate
- [ ] CSV export

**Security**
- [ ] RBAC: Admin / Dispatcher / Driver
- [ ] Full audit log (all access, all trip events)
- [ ] AES-256 at rest, TLS in transit, JWT auth

---

### Phase 2 — Integrations (Weeks 11–18)
- [ ] Route optimization (OSRM — self-hosted)
- [ ] ModivCare + MTM broker APIs
- [ ] Medicaid billing (837P claim format)
- [ ] Rider self-service portal
- [ ] Advanced driver analytics

### Phase 3 — Scale (Weeks 19–26)
- [ ] Multi-tenant / multi-provider
- [ ] AI auto-scheduling
- [ ] React Native mobile apps
- [ ] Managed cloud tier

---

## 6. Recommended Tech Stack

### Full-Stack TypeScript Monorepo

| Layer | Technology | Notes |
|---|---|---|
| Frontend | React 18 + TypeScript + TailwindCSS | Dispatcher dashboard |
| UI Components | shadcn/ui | WCAG 2.1 AA accessible |
| Data fetching | TanStack Query | Caching, background sync |
| Maps | Leaflet + OpenStreetMap | Free, no API key |
| Mobile (Driver) | React Native (Expo) | iOS + Android, shares types with web |
| Backend | Node.js + Express + TypeScript | REST API + Socket.io |
| Database | PostgreSQL + PostGIS | Geofencing, trip data, audit logs |
| Cache | Redis + Redis Geo | OTP storage, driver locations, sessions |
| Real-time | Socket.io | Driver GPS → Dispatcher map |
| SMS | Twilio | OTP codes + ride notifications |
| Email | SendGrid | Dispatcher alerts |
| Deployment | Docker + Docker Compose | One-command self-hosted deploy |

### Self-Hosting Target
Runs on a **$10–15/month VPS** (DigitalOcean, Hetzner, Vultr):
- 2 vCPU, 4GB RAM
- Single `docker-compose up -d` to deploy
- Handles 5–10 concurrent dispatchers, 50+ drivers

---

## 7. Smart OTP Verification — Technical Design

```
PICKUP FLOW:
────────────────────────────────────────────────────────
1. Driver approaches pickup → enters 100m GPS geofence
2. Server detects geofence entry via PostGIS ST_DWithin
3. Server generates OTP: crypto.randomInt(100000, 999999)
4. OTP stored in Redis: key=trip:{id}:otp  TTL=600s
5. SMS sent via Twilio: "MidTransport: Pickup code is 482917"
6. Driver app shows OTP entry screen
7. Rider reads code to driver → driver enters [ 4 8 2 9 1 7 ]
8. Server verifies OTP hash, marks trip as "Picked Up"
9. Audit log: { trip_id, event:'pickup', gps, timestamp, otp_verified:true }
────────────────────────────────────────────────────────
SAME FLOW at dropoff → creates complete proof-of-service

FALLBACK (rider has no phone):
- Driver taps [No Phone] → takes timestamped photo
- Photo stored with GPS coords → audit log entry
────────────────────────────────────────────────────────
```

---

## 8. Real-Time Driver Tracking — Technical Design

```
TRACKING ARCHITECTURE:
────────────────────────────────────────────────────────
Driver App (Expo expo-location)
    ↓  GPS updates every 10s (HIGH accuracy on trip)
    ↓  WebSocket emit: driver:location { lat, lng, speed, heading }
Socket.io Server (Node.js)
    ↓  Validates driver auth token
    ↓  GEORADD driver:{id} lng lat  → Redis Geo
    ↓  Checks PostGIS geofence: ST_DWithin(driver_pos, destination, 100)
    ↓  If inside geofence → trigger OTP SMS
    ↓  INSERT driver_locations (log for replay)
    ↓  Broadcast: dispatcher:driver-update → all dispatchers
Dispatcher Dashboard (React + Leaflet)
    ↓  Receives Socket.io driver-update events
    ↓  Updates driver marker position on Leaflet map in real time
    ↓  Updates driver metrics panel (speed, idle, trips)
────────────────────────────────────────────────────────
```

---

## 9. Project File Structure

```
midtransport/
├── docker-compose.yml
├── .env.example
├── apps/
│   ├── web/                    # React dispatcher dashboard
│   │   └── src/
│   │       ├── pages/
│   │       │   ├── Dashboard.tsx
│   │       │   ├── Trips.tsx
│   │       │   ├── Riders.tsx
│   │       │   ├── Drivers.tsx
│   │       │   └── Reports.tsx
│   │       └── components/
│   │           ├── TripBoard/
│   │           ├── LiveMap/
│   │           │   ├── DriverMarker.tsx
│   │           │   ├── GeofenceLayer.tsx
│   │           │   └── DriverPanel.tsx
│   │           └── CSVImport/
│   ├── mobile/                 # React Native (Expo) driver app
│   │   └── src/screens/
│   │       ├── TripList.tsx
│   │       ├── ActiveTrip.tsx
│   │       └── OTPEntry.tsx
│   └── api/                    # Node.js + Express backend
│       └── src/
│           ├── routes/
│           │   ├── auth.ts
│           │   ├── trips.ts
│           │   ├── riders.ts
│           │   ├── drivers.ts
│           │   ├── import.ts
│           │   ├── tracking.ts
│           │   └── otp.ts
│           ├── sockets/
│           │   └── locationHandler.ts
│           ├── services/
│           │   ├── geofence.ts
│           │   ├── otp.ts
│           │   └── sms.ts
│           └── db/
│               └── schema.sql
└── docs/
    ├── BAA-template.md
    ├── data-model.md
    └── csv-import-template.csv
```

---

## 10. Sources

- [NEMT Market Report 2025 — NEMTrepreneur](https://www.nemtrepreneur.com/blog/2025-non-emergency-medical-transportation-nemt-industry-stats-and-data-report)
- [Top 10 NEMT Software 2025 — NEMTrepreneur](https://www.nemtrepreneur.com/blog/top-10-nemt-software-for-2025-and-how-they-compare)
- [NEMT Software Comparison — UpperInc](https://www.upperinc.com/blog/best-nemt-dispatch-software/)
- [MediRoutes API Documentation](https://support.mediroutes.com/knowledge/mediroutes-api-documentation)
- [HIPAA & PHI Definition — HIPAA Journal](https://www.hipaajournal.com/considered-phi-hipaa/)
- [HIPAA & Transit Agencies — National Academies Press](https://nap.nationalacademies.org/read/22359/chapter/10)
- [HIPAA Compliance in NEMT — NEMT Platform](https://nemtplatform.com/blogs/hipaa-compliance-in-nemt-a-practical-guide-for-protecting-patient-data)
- [Bambi NEMT — Automated Trip Verification](https://www.hibambi.com/blog/automated-trip-verification-nemt-companies)
- [RouteGenie Pricing](https://routegenie.com/pricing/)
- [Healthcare App UX — Eleken](https://www.eleken.co/blog-posts/user-interface-design-for-healthcare-applications)
- [Accessibility for Elderly — PMC](https://pmc.ncbi.nlm.nih.gov/articles/PMC12350549/)
