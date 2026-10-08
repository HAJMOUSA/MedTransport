# MidTransport — Real‑World Testing Guide

Welcome! You're helping test MidTransport, a dispatch + driver platform for
non‑emergency medical transportation. This guide has a section for each role —
**Admin**, **Dispatcher**, and **Driver**. Read the "Everyone" section first,
then jump to your role.

---

## Everyone: read this first

**What you're testing**
- **Web dashboard** (Admin + Dispatcher): <https://midtransport.hajmousa.com>
  — works in Chrome, Edge, or Safari on a computer *or* a phone.
- **Driver app** (Driver): an Android app you install on your phone (details in
  the Driver section).

**Test logins** (shared test accounts — password is `Demo1234!` for all):

| Role | Email | Password |
|------|-------|----------|
| Admin | `demo@sunrise.demo` | `Demo1234!` |
| Dispatcher | `dispatch@sunrise.demo` | `Demo1234!` |
| Driver | `marcus.driver@sunrise.demo` | `Demo1234!` |
| Driver | `danny.driver@sunrise.demo` | `Demo1234!` |
| Driver | `latoya.driver@sunrise.demo` | `Demo1234!` |
| Driver | `priya.driver@sunrise.demo` | `Demo1234!` |

> The Admin can also create brand‑new accounts for each real tester (recommended
> so everyone has their own login) — see the Admin section.

**Important things to know while testing**
- This is a **shared test environment**. Anything you create (trips, riders,
  drivers) is visible to all other testers. That's expected.
- **Text‑message (SMS) codes are turned OFF** for this test. Riders will **not**
  receive a 6‑digit code by text. When the driver app asks for an arrival code,
  the driver taps **"Use Photo Fallback"** instead (take a quick photo). Full
  details in the Driver section.
- Times are shown in **US Eastern time**. Arrival is auto‑detected within about
  **100 meters** of the pickup/dropoff address.
- Please report anything odd — see "How to report a problem" at the end.

---

## 👤 ADMIN — set up the people and data

The Admin runs the organization: creates drivers, manages riders, and sees
reports.

1. Go to <https://midtransport.hajmousa.com> and sign in with the **Admin** login.
2. **Create a driver account** for each real driver tester:
   - Left menu → **Drivers** → **Add Driver**.
   - Enter name, email, phone, a password (at least 8 characters), and (optional)
     license number/expiry and vehicle.
   - Give that driver their **email + password** — they'll use it to log into the
     phone app.
3. **Add riders** (the people being transported):
   - Left menu → **Riders** → **Add Rider** (name, phone, home address, mobility
     type). You can also bulk‑import with **Import → CSV**.
4. **Change your password** (recommended): top/left menu → **Settings** →
   Change Password.
5. **Check reports**: Left menu → **Reports** — pick a date range and review the
   trip, on‑time, and driver summaries. (Export to CSV if you like.)

✅ *Admin test checklist:* created a driver, created a rider, viewed Reports
without errors, dashboard cards load.

---

## 🧭 DISPATCHER — create trips and watch them happen live

The Dispatcher schedules trips, assigns drivers, and monitors them in real time.

1. Sign in at <https://midtransport.hajmousa.com> with the **Dispatcher** login.
2. **Create a trip**: Left menu → **Trips** → **Add Trip**.
   - Choose the rider, pickup address, dropoff address, pickup time, and mobility
     / level of service. Save.
3. **Assign a driver** to the trip so it becomes **Dispatched** (the driver will
   then see it in their app).
4. **Watch the board**: Left menu → **Trips → Board**. Trips move across columns
   (Scheduled → Dispatched → En Route → Arrived → Picked Up → Completed) as the
   driver updates them — this updates **live**, no refresh needed.
5. **Watch the live map**: Trips → **Live Map**. On‑shift drivers appear as pins
   and move in near‑real‑time (updates roughly every 10 seconds) while a driver
   has a trip open. Click a pin for driver details.
6. **Refresh test**: press F5 / reload on any page — you should **stay logged in**
   and land on the same page (not be kicked to the login screen).

✅ *Dispatcher test checklist:* created + assigned a trip, saw the driver's pin
on the live map, watched the trip status change on the board in real time, page
refresh kept you logged in.

---

## 🚐 DRIVER — install the app and run a trip

### 1. Install the app (Android)

> The app is an Android `.apk` file (not yet on the Play Store). You need an
> Android phone (Android 6 or newer).

1. Your coordinator will send you a **download link** to the file
   `midtransport-driver-v1.0.0-b2.apk`.
2. Open the link on your phone and download it.
3. Tap the downloaded file to install. Android will ask to **allow installing
   from this source** the first time — turn that on, then tap **Install**.
4. Open **MidTransport Driver**.

*(iPhone is not supported in this test round.)*

### 2. Log in and go on shift

1. Enter the **email + password** your Admin gave you → **Sign In**.
2. Flip the **On Shift** switch (top‑right) to **On**.
3. When asked, **allow Location** — choose **"While using the app"** (or "Allow
   all the time" for best tracking). Also **allow Camera** when prompted (needed
   for arrival photos).

### 3. Run a trip

1. Your assigned trips appear under **Active**. Tap one to open it.
2. Tap **🧭 Navigate** to open directions to the pickup.
3. Use the big action button to update your status as you go:
   - **▶ Start Trip** → heading to pickup
   - **📍 Arrived at Pickup** (tap when you're there)
   - **✅ Picked Up — Enter OTP** (confirm the rider — see next step)
   - **▶ En Route to Dropoff**
   - **📍 Arrived at Dropoff**
   - **✅ Complete — Enter OTP** (confirm drop‑off)

### 4. Confirming pickup & drop‑off (important for this test)

When you tap a "**Enter OTP**" button, the app opens a code screen. **Because
test text‑messaging is turned off, the rider will NOT get a code.** So:

1. On the code screen, tap **"📷 Use Photo Fallback"** (under *"Rider has no
   phone?"*).
2. Tap **Open Camera**, take a clear photo of the rider, then **Submit Photo**.
3. At **drop‑off**, after the photo the app asks for the rider's **signature** —
   have the rider sign with a finger, then submit.

That completes the trip. (If/when real SMS is enabled later, the rider will get a
6‑digit code to read to you instead of the photo step.)

### 5. Other things to try
- **Report No‑Show** / **Cancel Trip** buttons on an active trip.
- Watch your own speed indicator update while driving.
- End your shift (flip **On Shift** off) when done.

✅ *Driver test checklist:* installed + logged in, went on shift, location
permission granted, opened a trip, used Navigate, updated each status, completed
pickup and dropoff via photo fallback + signature.

---

## 📑 Importing data from CSV (Admin / Dispatcher)

The app has **two** separate CSV imports. Use the one that matches what you're
loading:

| Import | Use it to load… | Where |
|--------|-----------------|-------|
| **Riders import** | Your client / passenger list | **Riders** page → **Import**, or Dashboard → **Import Riders CSV** |
| **Trips import** | Scheduled trips (e.g. a broker/scheduler export like ModivCare / MTM) | Left menu → **Import** |

General rules for both: files must be **`.csv`**, up to **20 MB**, with a
**header row** (column names in the first row).

---

### A) Riders import — simple, fixed columns

1. Go to **Riders → Import** (or Dashboard → **Import Riders CSV**).
2. Click **Download template** to get a CSV with the exact headers + example rows.
3. Fill it in, save as `.csv`, and **upload**. The import runs and then shows how
   many rows were **imported / skipped / errored**.

**Columns** (header names are case‑insensitive; spaces become underscores, so
`Full Name` = `full_name`). Alternate names in parentheses are also accepted:

| Column | Required | Notes / accepted alternatives |
|--------|:---:|-------|
| `name` | ✅ | or `full_name`, `patient_name` |
| `phone` | ✅ | or `phone_number`, `mobile` |
| `address` | — | or `home_address` |
| `mobility_type` | — | one of `standard`, `wheelchair`, `stretcher`, `bariatric` (defaults to `standard`) |
| `emergency_contact` | — | free text |
| `notes` | — | or `dispatcher_notes` |
| `insurance_id` | — | or `member_id`, `medicaid_id` |
| `insurance_name` | — | or `insurer`, `payer` |

**Rules:** `name` and `phone` are required; a rider whose **phone already
exists** is **skipped** (no duplicates); bad rows are reported with the row
number.

---

### B) Trips import — flexible column mapping (for broker/vendor files)

Use this when trips come from an outside system whose column names don't match
ours. You **map** their columns to MidTransport's fields once, and can **save
that mapping** ("vendor profile") so the same file layout is recognized
automatically next time.

**The wizard has 5 steps:** **Upload → Map → Validate → Preview → Results.**

1. **Upload** your `.csv` (left menu → **Import**). The app reads your headers,
   and if you've imported this layout before it **auto‑detects the saved vendor
   profile** and **pre‑suggests a mapping**.
2. **Map** each of your CSV columns to a MidTransport field. Required target
   fields:

   | MidTransport field | Required | Notes |
   |--------------------|:---:|-------|
   | **External Trip ID** | ✅ | the vendor's unique trip id (used to detect duplicates) |
   | **Pickup Date/Time** | ✅* | *required unless the trip is **Will Call** |
   | **Passenger First Name** | ✅ | |
   | **Passenger Last Name** | ✅ | |
   | **Primary Phone** | ✅ | digits, optional leading `+` |
   | **Pickup Address** | ✅ | structured — map **street / city / state / zip** |
   | **Drop‑off Address** | ✅ | structured — map **street / city / state / zip** |
   | **Level of Service** | ✅ | translated to your org's service codes |
   | **Trip Type** | ✅ | translated to your org's list |
   | Appointment Date/Time, Date of Birth, Medical ID, Alternate Phone, Additional Passengers, Assistance Needs, Status, Distance (miles), Notes, Will Call | — | optional |

   **Field‑matching tips:**
   - **Addresses are structured** — map the separate street/city/state/ZIP
     columns to the address's parts (e.g. *Pickup Address → Street*, *→ City*,
     *→ State*, *→ ZIP*).
   - **Dates:** if your file has separate date and time columns, map each to the
     **Date** and **Time** parts of *Pickup Date/Time*. A single combined column
     works too.
   - **Medical ID** is treated as **text** so leading zeros are preserved — don't
     store it as a number.
   - **Level of Service / Trip Type / Status** are "controlled" lists: your
     source values are translated to the org's values, and any **unknown value is
     flagged** so you can correct it.
   - Click **Save as profile** to reuse this mapping — manage saved ones under
     **Import → Profiles**.
3. **Validate**: the app checks every row and tells you how many are **valid vs.
   have errors** (with the reason and row number) — *before* anything is saved.
4. **Preview**: review the rows that will be created.
5. **Results / Execute** with options:
   - **Mode:** **Test** (dry run — saves nothing), **Valid rows only** (import the
     good rows, skip the bad), or **All‑or‑nothing** (*admin only* — import every
     row or none).
   - **Duplicate policy** (matched by **External Trip ID**): **Skip**, **Reject**,
     or **Update** (*Update is admin only*).
   - After it runs you'll see **imported / updated / skipped / duplicate / error**
     counts, and can **Download the errors CSV** to fix the bad rows and re‑import.

> Tip: start with **Mode = Test** and **Duplicate = Skip** on your first run to
> see what would happen without changing any data.

---

## 🔄 Suggested full end‑to‑end test (all three together)

1. **Admin** creates a driver account and a rider (or use the test accounts).
2. **Dispatcher** creates a trip for that rider and assigns the driver.
3. **Driver** gets the trip in the app, goes on shift, opens it, and drives it —
   updating status and completing pickup/dropoff with the photo fallback +
   signature.
4. **Dispatcher** watches the driver's pin move on the Live Map and the trip
   advance across the Board in real time.
5. **Admin** opens **Reports** and confirms the completed trip shows up.

---

## 🐞 How to report a problem

For anything broken, confusing, or surprising, send:
- **Your role** (Admin / Dispatcher / Driver) and the **account email** used
- **What you did** (the steps)
- **What you expected** vs **what actually happened**
- A **screenshot** if possible, and the **approximate time** it happened
- For the driver app: your **phone model** and Android version

Send reports to your coordinator. Thank you for testing! 🙌

---

### Known limitations in this test round
- **SMS codes are off** — use the photo fallback (above). Can be enabled later.
- It's a **shared test server** on a small instance — occasional slowness is fine
  to note but expected.
- The driver app is **Android‑only** for now and is side‑loaded (not from the
  Play Store).
