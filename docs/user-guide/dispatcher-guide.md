# Dispatcher Web Guide

The dispatcher dashboard is where admins and dispatchers run daily operations. This guide walks through every screen.

## Signing in

1. Open your dashboard URL in a browser.
2. Enter your email and password → **Sign in**.
3. New account? Open **Settings → Change Password** right away.

If you're inactive for a while you may be signed out; just sign in again.

## The layout

- **Left sidebar** — navigation: Dashboard, Trips, Riders, Import, Drivers, Reports, Settings. It also has an **Import Riders CSV** shortcut and your account menu (with **Sign out**) at the bottom.
- **Top bar** — a menu button (on small screens) and a notifications bell.
- On phones/tablets the sidebar collapses; tap the menu icon to open it.

---

## Dashboard

Your at-a-glance home screen:

- **KPI cards** — today's key numbers (e.g. trips scheduled/completed, active drivers, on-time performance).
- **Driver performance table** — per-driver metrics for the day.

Use it as a quick health check at the start and end of a shift.

---

## Trips

The heart of the app. Two views, switchable at the top:

### Board view (Kanban)
Trips are cards arranged in columns by status:

`Scheduled → Dispatched → En-route pickup → Arrived pickup → Picked up → En-route drop-off → Arrived drop-off → Completed` (plus **Cancelled** and **No-show**).

- Each **trip card** shows the rider, pickup/drop-off, time, and a mobility icon (wheelchair/stretcher/etc.).
- As drivers work, cards move across the board **automatically** (driven by GPS arrival + OTP).

### Map view
A live Leaflet map showing:
- **Driver pins** moving in real time (from the driver app's GPS).
- **Pickup/drop-off markers** for trips.
- Click a driver to open the **driver panel** with live speed, status, and current trip.

### Adding a trip
1. Click **Add Trip**.
2. Choose or create the **rider** (address autocomplete fills coordinates).
3. Enter **pickup** and **drop-off** addresses, the **pickup time** (or mark **will-call**), **mobility type**, and any notes.
4. Optionally add a **return leg** (creates the trip back home in one step).
5. Save. The trip appears in **Scheduled**.

### Assigning a driver
- Open a trip and choose a driver (and vehicle). The trip moves to **Dispatched** and shows up in that driver's app.
- Reassign at any time the same way.

### Editing / changing status
- Open a trip to edit details or manually change status (e.g. mark **Cancelled** or **No-show**).
- Normally you won't need to set statuses by hand — the driver app and GPS/OTP flow advance them for you.

### Trip statuses explained
| Status | Meaning |
|---|---|
| Scheduled | Created, not yet assigned/sent. |
| Dispatched | Assigned to a driver. |
| En-route pickup | Driver heading to the rider. |
| Arrived pickup | Driver within the arrival zone; rider gets an OTP. |
| Picked up | Pickup verified (OTP or photo). |
| En-route drop-off | Heading to the destination. |
| Arrived drop-off | At the destination; OTP for drop-off. |
| Completed | Drop-off verified. |
| Cancelled | Trip called off. |
| No-show | Rider not present at pickup. |

---

## Riders

Manage passenger contact records (contact info only — **no medical data**).

- **List / search** riders by name or phone.
- **Add / edit** a rider: name, phone(s), email, home address (with autocomplete), emergency contact, mobility type, and operational notes (e.g. "prefers side-door pickup"). *Do not enter medical information.*
- **Import Riders CSV** (sidebar shortcut): drag-and-drop a CSV to bulk-add riders. Download the template first if unsure of the columns.
- Deleting a rider is **admin-only**.

---

## Drivers

- Cards for each driver showing vehicle, shift status, and **live metrics** (trips today, on-time rate, etc.).
- **Add / edit** drivers (creates their login), assign a **vehicle**, and record license details.
- A driver appears as "on shift" once they tap **Go on shift** in the mobile app.

---

## Import (Trip Import Wizard)

Bring trips in from a broker/vendor CSV. The wizard has five steps and remembers vendor layouts as reusable **profiles**.

### Step 1 — Upload
Drag in or select the vendor's `.csv`. MidTransport reads the columns and, if it recognizes the layout, **auto-detects a saved vendor profile**.

### Step 2 — Map columns
Match each column in your file to a MidTransport field.

- **Columns are auto-matched for you.** Confident matches (e.g. *DOB → Date of Birth*, *Phone → Primary Phone*, *PU City → Pickup Address · city*) are prefilled and marked with a small **"auto"** tag.
- If you selected a **vendor profile**, its saved mapping is used; auto-match only fills columns the profile doesn't cover.
- **You can change anything** — every column is a dropdown. Your edits always win. Set a column to "— ignore —" to skip it.
- **Reset manual edits** clears your changes and returns to the suggested/profile mapping.
- A warning lists any **required fields** not yet mapped — you can't continue until they're covered.
- **Admins** can **Save as new profile** (or **Save as new version**) so next time this vendor's file is recognized and mapped automatically.

Required fields include: External Trip ID, Pickup Date/Time (unless will-call), Passenger First/Last Name, Primary Phone, Pickup Address, Drop-off Address, Level of Service, Trip Type.

### Step 3 — Preview
See a small **sample** of how your rows will be interpreted (sensitive values are masked). Confirm it looks right.

### Step 4 — Validate
A dry run checks every row and reports:
- counts of **valid / warning / invalid / duplicate** rows and **new vs. existing riders**,
- per-row **issues** with guidance (e.g. bad phone, unknown level of service).
No data is saved yet.

### Step 5 — Import (Execute)
Choose how to commit:
- **Mode**: *Test* (validate only), *All-or-nothing* (import only if every row is valid), or *Valid rows only* (import the good rows, skip the bad).
- **Duplicate policy** (matched by the vendor's trip ID): *Skip*, *Reject*, or *Update* existing trips.

After importing you'll see counts of imported/updated/skipped/duplicate/errored rows, and can **download a CSV of rejected rows** with reasons to fix and re-import.

### Vendor profiles (`Import → Profiles`)
Admins manage saved vendor mappings here — view versions and keep layouts current as brokers change their exports.

---

## Reports

- Pick a **date range** to see summary analytics: totals, completion/on-time rates, and per-driver performance.
- **Export CSV** for billing or record-keeping.

---

## Settings

- **Change Password** — update your own password. Do this on first login.

---

## Tips

- The board and map update **live** — no need to refresh.
- Leave a trip as **will-call** when the rider will call when ready; you can assign a driver without a fixed pickup time.
- Save a **vendor profile** the first time you import a new broker's file — future imports become one-click.
- For SMS pickup codes to actually send, your administrator must configure Twilio; otherwise the system runs in a test mode (codes appear in server logs). See [FAQ & Troubleshooting](faq-troubleshooting.md).
