# FAQ & Troubleshooting

## General

**Q: What does MidTransport store about riders?**
Only contact information — name, phone, address, emergency contact, and operational notes. It intentionally stores **no medical records**. Don't put medical information in notes fields.

**Q: Do I need to refresh to see updates?**
No. The trip board and live map update in real time as drivers move and confirm trips.

**Q: What are the trip statuses?**
Scheduled → Dispatched → En-route pickup → Arrived pickup → Picked up → En-route drop-off → Arrived drop-off → Completed, plus Cancelled and No-show. They usually advance automatically from the driver app + GPS/OTP.

## Accounts & sign-in

**Q: How do I change my password?**
Dispatcher web: **Settings → Change Password**. Do this on first login.

**Q: I got signed out.**
Sessions expire for security. Just sign in again.

**Q: A driver can't sign in.**
An admin/dispatcher creates driver logins under **Drivers**. Confirm the email is correct and the account is active; reset by editing the driver.

## OTP / pickup codes

**Q: The rider didn't receive a text code.**
SMS requires Twilio to be configured by your administrator. If it isn't (common in test/demo setups), the system runs in **test mode** and codes are written to the server logs instead of being texted. For a real deployment, ask your admin to set the Twilio settings. Meanwhile, drivers can use the **photo fallback**.

**Q: The rider has no phone.**
On the code screen the driver taps the **photo** option to capture a timestamped photo — this still records proof of the pickup/drop-off.

**Q: The code expired.**
Codes are valid for a few minutes (default 10). Have the driver use the photo fallback, or dispatch can help re-trigger.

**Q: Why do we use codes at all?**
They create a tamper-evident, time-stamped, GPS-tagged record of each pickup/drop-off — useful for Medicaid billing and disputes.

## Live map / GPS

**Q: A driver isn't showing on the map.**
Check that the driver has tapped **Go on shift**, has location permission enabled, and has the app open during trips. Drivers only appear while on shift.

**Q: Driver location looks stale.**
Positions update as the app reports GPS; brief gaps can happen with poor signal or if the app is backgrounded. It self-corrects when signal returns.

## Importing trips

**Q: The importer didn't recognize my file's columns.**
Auto-match handles confident matches; anything ambiguous stays "— ignore —". Just set those dropdowns manually. Required fields must all be mapped before you can continue.

**Q: Can I avoid mapping columns every time?**
Yes — an **admin** can **Save as new profile** on the mapping step. Next time that vendor's file is uploaded, MidTransport recognizes it and maps automatically.

**Q: Some rows were rejected.**
After import, download the **rejected-rows CSV** for the exact reasons (e.g. invalid phone, unknown level of service), fix them, and re-import.

**Q: What do the import modes mean?**
*Test* = validate only (no save). *All-or-nothing* = import only if every row is valid. *Valid rows only* = import the good rows and skip the bad. The **duplicate policy** (Skip/Reject/Update) controls what happens when a trip with the same vendor trip ID already exists.

**Q: What's a "will-call" trip?**
A trip with no fixed pickup time — the rider calls when ready. You can still assign a driver.

## Reports

**Q: How do I export data for billing?**
**Reports** → pick a date range → **Export CSV**.

## For administrators

**Q: How do we enable real SMS?**
Set `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, and `TWILIO_PHONE_NUMBER` in the server `.env` and restart. See the developer docs: [Configuration Reference](../developer/13-configuration-reference.md).

**Q: Where are backups and operations documented?**
See [Deployment & Operations](../developer/12-deployment-operations.md).

**Q: Something is broken server-side — where do I look?**
Check container status and logs: `docker compose ps` and `docker compose logs -f api`. Health endpoint: `https://<your-domain>/api/health`. More in the developer handbook.
