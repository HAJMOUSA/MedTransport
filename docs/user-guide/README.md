# MidTransport User Guide

Welcome to MidTransport — a dispatch platform for non-emergency medical transportation. This guide explains how to use the software day to day.

## Who uses what

MidTransport has two apps:

- **Dispatcher Dashboard (web)** — used by **admins** and **dispatchers** in a web browser to manage riders, drivers, and trips; watch drivers on a live map; import trips; and run reports. → [Dispatcher Web Guide](dispatcher-guide.md)
- **Driver App (mobile)** — used by **drivers** on their phone to see their trips, go on shift, navigate, and verify pickups/drop-offs. → [Driver App Guide](driver-app-guide.md)

## Roles at a glance

| Role | Can do |
|---|---|
| **Admin** | Everything: manage users/drivers/vehicles, delete riders, create import profiles, plus all dispatcher tasks. |
| **Dispatcher** | Manage riders and trips, assign drivers, import trips, watch the live map, run reports. |
| **Driver** | See assigned trips, go on/off shift, navigate, verify pickups/drop-offs (mobile app only). |

## Getting started (dispatcher/admin)

1. Open the dashboard URL your administrator gave you (e.g. `https://midtransport.yourcompany.com`).
2. Sign in with your email and password.
3. **First login:** go to **Settings → Change Password** and set your own password immediately.
4. You'll land on the **Dashboard** with today's key numbers.

## Getting started (driver)

1. Install the MidTransport driver app on your phone (your dispatcher will provide it).
2. Sign in with the email and password your dispatcher created for you.
3. Tap **Go on shift** to start receiving and tracking trips.

## A typical day (workflow overview)

```
Dispatcher                                   Driver
──────────                                   ──────
Import or add today's trips
Assign trips to drivers  ───────────────►    Sees trips on phone, goes on shift
Watch drivers on the live map  ◄──────────   Drives; app reports live GPS
                                             Arrives → rider gets an SMS code
                                             Enters the code to confirm pickup
Trip auto-updates on the board  ◄──────────  Repeats for drop-off
Review completed trips / reports
```

## Key concepts

- **Trip statuses** move left→right: Scheduled → Dispatched → En-route to pickup → Arrived → Picked up → En-route to drop-off → Arrived → Completed. Trips can also be **Cancelled** or **No-show**.
- **Will-call** trips have no fixed pickup time — the rider calls when ready.
- **OTP (one-time passcode)** is a 6-digit code texted to the rider at arrival; the driver enters it to prove the pickup/drop-off happened. If the rider has no phone, the driver takes a photo instead.
- **Mobility types**: standard, wheelchair, stretcher, bariatric — match riders to the right vehicle.

Continue to the [Dispatcher Web Guide](dispatcher-guide.md) or the [Driver App Guide](driver-app-guide.md). Stuck? See [FAQ & Troubleshooting](faq-troubleshooting.md).
