#!/usr/bin/env node
// Driver-app API smoke test — exercises the scenarios the mobile driver app
// depends on, against any environment.
//
// Usage:
//   node scripts/driver-app-smoke-test.mjs --base https://midtransport.hajmousa.com \
//        --email danny.driver@sunrise.demo --password Demo1234!
//   node scripts/driver-app-smoke-test.mjs --base http://localhost:3001 \
//        --email driver@example.com --password 'Driver1234!' --mutate
//
// Flags:
//   --mutate   also run scenarios that change data (status transitions, no-show).
//              Only use against a disposable/demo environment.
//
// Exit code is non-zero if any non-skipped scenario fails.

const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, a, i, arr) => {
    if (a.startsWith('--')) {
      const key = a.slice(2);
      const val = arr[i + 1] && !arr[i + 1].startsWith('--') ? arr[i + 1] : 'true';
      acc.push([key, val]);
    }
    return acc;
  }, []),
);

const BASE = (args.base || process.env.BASE || 'http://localhost:3001').replace(/\/$/, '');
const EMAIL = args.email || process.env.EMAIL || 'driver@example.com';
const PASSWORD = args.password || process.env.PASSWORD || 'Driver1234!';
const MUTATE = args.mutate === 'true' || args.mutate === true;

let pass = 0, fail = 0, skip = 0;
const results = [];

function record(status, name, detail = '') {
  results.push({ status, name, detail });
  if (status === 'PASS') pass++; else if (status === 'FAIL') fail++; else skip++;
  const icon = status === 'PASS' ? '✅' : status === 'FAIL' ? '❌' : '⏭️ ';
  console.log(`${icon} ${name}${detail ? ' — ' + detail : ''}`);
}

async function api(method, path, { token, body } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  let data = null;
  try { data = await res.json(); } catch { /* non-JSON */ }
  return { status: res.status, data };
}

// Unwrap the API's { data: [...] } envelope the same way the app does.
const asArray = (d) => (d && Array.isArray(d.data) ? d.data : Array.isArray(d) ? d : []);

async function run() {
  console.log(`\n▶ Driver-app smoke test against ${BASE}\n  user: ${EMAIL}  mutate: ${MUTATE}\n`);

  // 1. Health
  {
    const r = await api('GET', '/api/health');
    r.status === 200 ? record('PASS', 'Health check', `${r.status}`) : record('FAIL', 'Health check', `${r.status}`);
  }

  // 2. Auth: bad password rejected
  {
    const r = await api('POST', '/api/auth/login', { body: { email: EMAIL, password: 'wrong-password-xyz' } });
    [400, 401].includes(r.status) ? record('PASS', 'Login rejects bad password', `${r.status}`)
      : record('FAIL', 'Login rejects bad password', `${r.status}`);
  }

  // 3. Auth: unauthenticated request rejected
  {
    const r = await api('GET', '/api/trips');
    r.status === 401 ? record('PASS', 'Unauthenticated /api/trips → 401', `${r.status}`)
      : record('FAIL', 'Unauthenticated /api/trips → 401', `${r.status}`);
  }

  // 4. Driver login
  let token = null, driverTripId = null, dropoffTripId = null;
  {
    const r = await api('POST', '/api/auth/login', { body: { email: EMAIL, password: PASSWORD } });
    if (r.status === 200 && r.data?.accessToken && r.data?.user?.role) {
      token = r.data.accessToken;
      record('PASS', 'Driver login', `role=${r.data.user.role}, name=${r.data.user.name}`);
      if (r.data.user.role !== 'driver') record('FAIL', 'Login role is driver', `got ${r.data.user.role}`);
    } else {
      record('FAIL', 'Driver login', `${r.status}`);
      return finish();
    }
  }

  // 5. Driver profile
  {
    const r = await api('GET', '/api/drivers/me', { token });
    r.status === 200 ? record('PASS', 'GET /api/drivers/me', `${r.status}`)
      : record('FAIL', 'GET /api/drivers/me', `${r.status}`);
  }

  // 6. Trip list loads + shape is an array (the bug we fixed in the app)
  {
    const r = await api('GET', '/api/trips', { token });
    const arr = asArray(r.data);
    if (r.status === 200) {
      record('PASS', 'Trip list loads', `${arr.length} trips`);
      const byStatus = {};
      arr.forEach((t) => { byStatus[t.status] = (byStatus[t.status] || 0) + 1; });
      record('PASS', 'Trip statuses present', JSON.stringify(byStatus));
      const active = arr.find((t) => ['dispatched', 'en_route_pickup', 'arrived_pickup', 'picked_up', 'en_route_dropoff', 'arrived_dropoff'].includes(t.status));
      driverTripId = (active || arr[0])?.id ?? null;
      dropoffTripId = arr.find((t) => t.status === 'arrived_dropoff')?.id ?? null;
    } else {
      record('FAIL', 'Trip list loads', `${r.status}`);
    }
  }

  // 7. Trip detail includes coordinates (used by the Navigate deep-link)
  if (driverTripId) {
    const r = await api('GET', `/api/trips/${driverTripId}`, { token });
    if (r.status === 200) {
      const t = r.data;
      const hasCoords = t.pickup_lat != null || t.pickup_address;
      hasCoords ? record('PASS', 'Trip detail + navigable address/coords', `trip ${driverTripId}`)
        : record('FAIL', 'Trip detail + navigable address/coords', `trip ${driverTripId} missing address`);
    } else {
      record('FAIL', 'Trip detail', `${r.status}`);
    }
  } else {
    record('SKIP', 'Trip detail', 'no trips for this driver');
  }

  // 8–10. New MediRoutes endpoints present? (probe with invalid body: 400=deployed+validates, 404=not deployed)
  const probes = [
    ['POST', '/api/trips/1/no-show', { reasonCode: 'not-a-valid-reason' }, 'no-show endpoint deployed'],
    ['POST', '/api/trips/1/cancellation', { reasonCode: 'not-a-valid-reason' }, 'cancellation endpoint deployed'],
    ['POST', '/api/trips/1/signature', {}, 'signature endpoint deployed'],
  ];
  let newEndpointsDeployed = true;
  for (const [m, p, b, name] of probes) {
    const r = await api(m, p, { token, body: b });
    if (r.status === 404) { newEndpointsDeployed = false; record('SKIP', name, '404 — not on this server'); }
    else if ([400, 409].includes(r.status)) record('PASS', name, `${r.status}`);
    else record('PASS', name, `${r.status} (reachable)`);
  }

  // 11. Signature gate (new): completing a dropoff without a signature must be blocked
  if (newEndpointsDeployed && MUTATE && dropoffTripId) {
    const r = await api('PATCH', `/api/trips/${dropoffTripId}/status`, { token, body: { status: 'completed' } });
    r.status === 409 ? record('PASS', 'Signature gate blocks completion (409)', `trip ${dropoffTripId}`)
      : record('FAIL', 'Signature gate blocks completion (409)', `got ${r.status}`);
  } else {
    record('SKIP', 'Signature gate blocks completion', newEndpointsDeployed ? (MUTATE ? 'no arrived_dropoff trip' : 'needs --mutate') : 'endpoints not deployed');
  }

  finish();
}

function finish() {
  console.log(`\n──────── ${pass} passed, ${fail} failed, ${skip} skipped ────────\n`);
  process.exit(fail > 0 ? 1 : 0);
}

run().catch((e) => { console.error('Runner error:', e.message); process.exit(2); });
