import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { X } from 'lucide-react';
import { api } from '../../lib/api';
import type { CanonicalTrip, ImportIssue } from '@midtransport/shared';

const DRAFT_KEY = 'mt-trip-draft';

interface AddressParts {
  street: string; city: string; state: string; zip: string;
  lat: number | null; lng: number | null;
}
interface RiderHit { id: number; name: string; phone: string; }
interface Suggestion {
  display: string; lat: number; lng: number;
  street: string; city: string; state: string; zip: string;
}
interface Lookups {
  levelOfService: Array<{ code: string; label: string }>;
  tripTypes: Array<{ value: string; label: string }>;
}
interface ValidationResult {
  valid: boolean;
  issues: ImportIssue[];
  duplicateWarning: { tripId: number; scheduledPickupAt: string } | null;
}
interface FormState {
  mode: 'search' | 'new';
  riderId: number | null; riderName: string; riderPhone: string;
  firstName: string; lastName: string; dob: string; phone: string; medicalId: string; assistanceNeeds: string;
  serviceDate: string; pickupTime: string; willCall: boolean;
  tripType: string; levelOfService: string;
  additionalPassengers: number; externalRef: string; notes: string;
  hasReturn: boolean; returnDate: string; returnTime: string;
  pickup: AddressParts; dropoff: AddressParts;
}

const emptyAddr: AddressParts = { street: '', city: '', state: '', zip: '', lat: null, lng: null };
const EMPTY_FORM: FormState = {
  mode: 'search', riderId: null, riderName: '', riderPhone: '',
  firstName: '', lastName: '', dob: '', phone: '', medicalId: '', assistanceNeeds: '',
  serviceDate: '', pickupTime: '', willCall: false,
  tripType: '', levelOfService: '', additionalPassengers: 0, externalRef: '', notes: '',
  hasReturn: false, returnDate: '', returnTime: '',
  pickup: emptyAddr, dropoff: emptyAddr,
};

const inputCls = 'w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500';
const labelCls = 'block text-sm font-medium text-gray-700 mb-1';
const STEPS = ['Passenger', 'Trip', 'Addresses', 'Review'];

// canonical field -> friendly label + wizard step (for review issues)
const FIELD_META: Record<string, { label: string; step: number }> = {
  passenger_first_name: { label: 'First name', step: 1 },
  passenger_last_name: { label: 'Last name', step: 1 },
  primary_phone: { label: 'Phone', step: 1 },
  date_of_birth: { label: 'Date of birth', step: 1 },
  medical_id: { label: 'Medical ID', step: 1 },
  pickup_at: { label: 'Pickup time', step: 2 },
  appointment_at: { label: 'Appointment time', step: 2 },
  trip_type: { label: 'Trip type', step: 2 },
  level_of_service: { label: 'Level of service', step: 2 },
  additional_passengers: { label: 'Additional passengers', step: 2 },
  external_trip_id: { label: 'External reference', step: 2 },
  notes: { label: 'Notes', step: 2 },
  pickup_address: { label: 'Pickup address', step: 3 },
  dropoff_address: { label: 'Dropoff address', step: 3 },
};

function useDebouncedValue<T>(value: T, ms: number): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

const addrToString = (a: AddressParts) => [a.street, a.city, a.state, a.zip].filter(s => s.trim()).join(', ');
const toIso = (date: string, time: string) => new Date(`${date}T${time}:00`).toISOString();

function buildCanonical(f: FormState): CanonicalTrip {
  // riders list returns a single `name`; split mirrors the server's split_part fallback
  const parts = f.riderName.trim().split(/\s+/);
  const first = f.mode === 'new' ? f.firstName.trim() : (parts[0] ?? '');
  const last = f.mode === 'new' ? f.lastName.trim() : (parts[1] ?? '');
  const phone = f.mode === 'new' ? f.phone.trim() : f.riderPhone.trim();
  const addr = (a: AddressParts) => a.street.trim()
    ? { street: a.street.trim(), city: a.city.trim(), state: a.state.trim(), zip: a.zip.trim() }
    : null;
  return {
    externalTripId: f.externalRef.trim() || null,
    willCall: f.willCall,
    appointmentAt: null,
    pickupAt: !f.willCall && f.serviceDate && f.pickupTime ? toIso(f.serviceDate, f.pickupTime) : null,
    passengerFirstName: first || null,
    passengerLastName: last || null,
    dateOfBirth: f.mode === 'new' && f.dob ? f.dob : null,
    medicalId: f.mode === 'new' && f.medicalId.trim() ? f.medicalId.trim() : null,
    primaryPhone: phone || null,
    alternatePhone: null,
    pickupAddress: addr(f.pickup),
    dropoffAddress: addr(f.dropoff),
    levelOfService: f.levelOfService || null,
    additionalPassengers: f.additionalPassengers,
    assistanceNeeds: f.mode === 'new' && f.assistanceNeeds.trim() ? f.assistanceNeeds.trim() : null,
    tripType: f.tripType || null,
    status: null,
    distanceMiles: null,
    notes: f.notes.trim() || null,
  };
}

function AddressInput({ label, value, onChange }: { label: string; value: AddressParts; onChange: (a: AddressParts) => void }) {
  const [text, setText] = useState('');
  const [open, setOpen] = useState(false);
  const debounced = useDebouncedValue(text, 300);
  const { data, isFetching } = useQuery<{ results: Suggestion[] }>({
    queryKey: ['geocode-search', debounced],
    queryFn: () => api.get('/api/geocode/search', { params: { q: debounced } }).then(r => r.data),
    enabled: open && debounced.trim().length >= 3,
  });

  const pick = (s: Suggestion) => {
    onChange({ street: s.street, city: s.city, state: s.state, zip: s.zip, lat: s.lat, lng: s.lng });
    setText(s.display);
    setOpen(false);
  };
  // Manual edits to parts drop geocoded coords so the server re-geocodes the final string
  const setPart = (patch: Partial<AddressParts>) => onChange({ ...value, ...patch, lat: null, lng: null });

  return (
    <div className="border border-gray-200 rounded-xl p-4 space-y-3">
      <p className="text-sm font-semibold text-gray-800">{label}</p>
      <div className="relative">
        <input
          type="text" value={text} placeholder="Search address…"
          onChange={e => { setText(e.target.value); setOpen(true); }}
          onFocus={() => setOpen(true)}
          className={inputCls} aria-label={`${label} search`}
        />
        {open && debounced.trim().length >= 3 && (
          <div className="absolute z-10 mt-1 w-full bg-white border border-gray-200 rounded-lg shadow-lg max-h-56 overflow-y-auto">
            {isFetching && <p className="px-3 py-2 text-xs text-gray-400">Searching…</p>}
            {!isFetching && (data?.results.length ?? 0) === 0 && (
              <p className="px-3 py-2 text-xs text-gray-400">No matches — fill the fields below manually.</p>
            )}
            {data?.results.map((s, i) => (
              <button key={i} type="button" onClick={() => pick(s)}
                className="block w-full text-left px-3 py-2 text-xs hover:bg-blue-50 border-b border-gray-50 last:border-0">
                {s.display}
              </button>
            ))}
          </div>
        )}
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        <input placeholder="Street *" value={value.street} onChange={e => setPart({ street: e.target.value })} className={inputCls} aria-label={`${label} street`} />
        <input placeholder="City" value={value.city} onChange={e => setPart({ city: e.target.value })} className={inputCls} aria-label={`${label} city`} />
        <input placeholder="State" value={value.state} onChange={e => setPart({ state: e.target.value })} className={inputCls} aria-label={`${label} state`} />
        <input placeholder="ZIP" value={value.zip} onChange={e => setPart({ zip: e.target.value })} className={inputCls} aria-label={`${label} zip`} />
      </div>
      {value.lat != null && value.lng != null && (
        <p className="text-xs text-green-600">Geocoded ({value.lat.toFixed(4)}, {value.lng.toFixed(4)})</p>
      )}
    </div>
  );
}

export function AddTripModal({ onClose }: { onClose: () => void }) {
  const queryClient = useQueryClient();
  const [step, setStep] = useState(1);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [search, setSearch] = useState('');
  const [draft, setDraft] = useState<FormState | null>(() => {
    try {
      const raw = localStorage.getItem(DRAFT_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw) as FormState;
      return JSON.stringify(parsed) !== JSON.stringify(EMPTY_FORM) ? parsed : null;
    } catch { return null; }
  });

  // Draft persistence — write on change, skip the untouched empty form
  useEffect(() => {
    if (JSON.stringify(form) === JSON.stringify(EMPTY_FORM)) return;
    localStorage.setItem(DRAFT_KEY, JSON.stringify(form));
  }, [form]);

  const debouncedSearch = useDebouncedValue(search, 300);
  const { data: hits, isFetching: searching } = useQuery<{ data: RiderHit[] }>({
    queryKey: ['rider-search', debouncedSearch],
    queryFn: () => api.get('/api/riders', { params: { search: debouncedSearch, limit: 8 } }).then(r => r.data),
    enabled: form.mode === 'search' && debouncedSearch.trim().length >= 2,
  });

  const { data: lookups } = useQuery<Lookups>({
    queryKey: ['trip-lookups'],
    queryFn: () => api.get('/api/trips/lookups').then(r => r.data),
  });

  const canonical = useMemo(() => buildCanonical(form), [form]);
  const validate = useMutation({
    mutationFn: (trip: CanonicalTrip) =>
      api.post('/api/trips/validate-canonical', { trip }).then(r => r.data as ValidationResult),
  });
  useEffect(() => {
    if (step === 4) validate.mutate(canonical);
    // validate on entering review; `canonical` is derived from form
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step]);

  const createTrip = useMutation({
    mutationFn: (payload: Record<string, unknown>) => api.post('/api/trips', payload).then(r => r.data),
    onSuccess: () => {
      localStorage.removeItem(DRAFT_KEY);
      queryClient.invalidateQueries({ queryKey: ['trips'] });
      onClose();
    },
  });

  const upd = (patch: Partial<FormState>) => setForm(f => ({ ...f, ...patch }));
  const stepOk = (s: number): boolean => {
    if (s === 1) return form.mode === 'search'
      ? form.riderId != null
      : !!(form.firstName.trim() && form.lastName.trim() && form.phone.trim());
    if (s === 2) return !!form.serviceDate && (form.willCall || !!form.pickupTime)
      && !!form.tripType && !!form.levelOfService
      && (!form.hasReturn || (!!form.returnDate && !!form.returnTime));
    if (s === 3) return !!form.pickup.street.trim() && !!form.dropoff.street.trim();
    return true;
  };

  const submit = () => {
    const notes = form.willCall ? `[Will Call] ${form.notes}`.trim() : form.notes.trim();
    const payload: Record<string, unknown> = {
      pickupAddress: addrToString(form.pickup),
      dropoffAddress: addrToString(form.dropoff),
      // trips.scheduled_pickup_at is NOT NULL and there is no will_call column: use a neutral
      // midday placeholder for will-call trips and flag them in dispatcher notes instead.
      scheduledPickupAt: form.willCall ? toIso(form.serviceDate, '12:00') : toIso(form.serviceDate, form.pickupTime),
      levelOfService: form.levelOfService,
      tripType: form.tripType,
      additionalPassengers: form.additionalPassengers,
    };
    if (form.pickup.lat != null) payload.pickupLat = form.pickup.lat;
    if (form.pickup.lng != null) payload.pickupLng = form.pickup.lng;
    if (form.dropoff.lat != null) payload.dropoffLat = form.dropoff.lat;
    if (form.dropoff.lng != null) payload.dropoffLng = form.dropoff.lng;
    if (form.externalRef.trim()) payload.externalTripId = form.externalRef.trim();
    if (notes) payload.dispatcherNotes = notes;
    if (form.mode === 'new') {
      payload.newRider = {
        firstName: form.firstName.trim(),
        lastName: form.lastName.trim(),
        phone: form.phone.trim(),
        ...(form.dob && { dateOfBirth: form.dob }),
        ...(form.medicalId.trim() && { medicalId: form.medicalId.trim() }),
      };
      if (form.assistanceNeeds.trim()) payload.assistanceNeeds = form.assistanceNeeds.trim();
    } else {
      payload.riderId = form.riderId;
    }
    if (form.hasReturn) payload.returnTrip = { pickupAt: toIso(form.returnDate, form.returnTime) };
    createTrip.mutate(payload);
  };

  const validation = validate.data;
  const hasErrors = validation?.issues.some(i => i.severity === 'error') ?? false;
  const submitDisabled = validate.isPending || !validation || !validation.valid || hasErrors || createTrip.isPending;
  const losLabel = lookups?.levelOfService.find(l => l.code === form.levelOfService)?.label ?? form.levelOfService;
  const typeLabel = lookups?.tripTypes.find(t => t.value === form.tripType)?.label ?? form.tripType;
  const passengerName = form.mode === 'new' ? `${form.firstName} ${form.lastName}`.trim() : form.riderName;

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4" role="dialog" aria-modal="true" aria-label="Add New Trip">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-2xl max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between p-5 border-b">
          <div>
            <h2 className="text-lg font-bold text-gray-900">Add New Trip</h2>
            <div className="flex gap-1 mt-2">
              {STEPS.map((s, i) => (
                <span key={s} className={`text-xs px-2 py-0.5 rounded-full ${step === i + 1 ? 'bg-blue-600 text-white' : step > i + 1 ? 'bg-blue-100 text-blue-700' : 'bg-gray-100 text-gray-500'}`}>
                  {i + 1}. {s}
                </span>
              ))}
            </div>
          </div>
          <button onClick={onClose} className="p-1 rounded-full hover:bg-gray-100" aria-label="Close">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-5 space-y-4">
          {draft && (
            <div className="flex items-center justify-between bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 text-sm">
              <span className="text-amber-800">Restore your saved draft?</span>
              <span className="flex gap-2">
                <button type="button" onClick={() => { setForm(draft); setDraft(null); }} className="text-amber-800 font-medium underline">Restore</button>
                <button type="button" onClick={() => { localStorage.removeItem(DRAFT_KEY); setDraft(null); }} className="text-gray-500 underline">Discard</button>
              </span>
            </div>
          )}

          {/* ── Step 1: Passenger ─────────────────────────────────── */}
          {step === 1 && (
            <div className="space-y-4">
              <div className="flex gap-2">
                {(['search', 'new'] as const).map(m => (
                  <button key={m} type="button" onClick={() => upd({ mode: m })}
                    className={`flex-1 rounded-lg border px-3 py-2 text-sm font-medium ${form.mode === m ? 'border-blue-600 bg-blue-50 text-blue-700' : 'border-gray-300 text-gray-600 hover:bg-gray-50'}`}>
                    {m === 'search' ? 'Existing passenger' : 'New passenger'}
                  </button>
                ))}
              </div>

              {form.mode === 'search' ? (
                <div className="space-y-2">
                  <label className={labelCls} htmlFor="riderSearch">Search by name or phone *</label>
                  <input id="riderSearch" type="text" value={search} onChange={e => setSearch(e.target.value)}
                    placeholder="Start typing…" className={inputCls} />
                  {searching && <p className="text-xs text-gray-400">Searching…</p>}
                  {!searching && debouncedSearch.trim().length >= 2 && (hits?.data.length ?? 0) === 0 && (
                    <p className="text-xs text-gray-400">No matching riders — switch to "New passenger" to add one.</p>
                  )}
                  <div className="divide-y divide-gray-100 border border-gray-200 rounded-lg max-h-56 overflow-y-auto">
                    {hits?.data.map(r => (
                      <button key={r.id} type="button"
                        onClick={() => upd({ riderId: r.id, riderName: r.name, riderPhone: r.phone })}
                        className={`block w-full text-left px-3 py-2 text-sm hover:bg-blue-50 ${form.riderId === r.id ? 'bg-blue-50' : ''}`}>
                        <span className="font-medium text-gray-800">{r.name}</span>
                        <span className="text-gray-500"> — {r.phone}</span>
                      </button>
                    ))}
                  </div>
                  {form.riderId != null && (
                    <p className="text-sm text-green-700 bg-green-50 border border-green-200 rounded-lg px-3 py-2">
                      Selected: {form.riderName} ({form.riderPhone})
                    </p>
                  )}
                </div>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className={labelCls} htmlFor="firstName">First name *</label>
                    <input id="firstName" type="text" value={form.firstName} onChange={e => upd({ firstName: e.target.value })} className={inputCls} />
                  </div>
                  <div>
                    <label className={labelCls} htmlFor="lastName">Last name *</label>
                    <input id="lastName" type="text" value={form.lastName} onChange={e => upd({ lastName: e.target.value })} className={inputCls} />
                  </div>
                  <div>
                    <label className={labelCls} htmlFor="dob">Date of birth</label>
                    <input id="dob" type="date" value={form.dob} onChange={e => upd({ dob: e.target.value })} className={inputCls} />
                  </div>
                  <div>
                    <label className={labelCls} htmlFor="phone">Phone *</label>
                    <input id="phone" type="tel" value={form.phone} onChange={e => upd({ phone: e.target.value })} className={inputCls} />
                  </div>
                  <div>
                    <label className={labelCls} htmlFor="medicalId">Medical ID</label>
                    <input id="medicalId" type="text" value={form.medicalId} onChange={e => upd({ medicalId: e.target.value })} className={inputCls} />
                  </div>
                  <div>
                    <label className={labelCls} htmlFor="assistanceNeeds">Assistance needs</label>
                    <input id="assistanceNeeds" type="text" value={form.assistanceNeeds} onChange={e => upd({ assistanceNeeds: e.target.value })} placeholder="e.g. Wheelchair, door-to-door" className={inputCls} />
                  </div>
                </div>
              )}
            </div>
          )}

          {/* ── Step 2: Trip ──────────────────────────────────────── */}
          {step === 2 && (
            <div className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className={labelCls} htmlFor="serviceDate">Service date *</label>
                  <input id="serviceDate" type="date" value={form.serviceDate} onChange={e => upd({ serviceDate: e.target.value })} className={inputCls} />
                </div>
                {!form.willCall && (
                  <div>
                    <label className={labelCls} htmlFor="pickupTime">Pickup time *</label>
                    <input id="pickupTime" type="time" value={form.pickupTime} onChange={e => upd({ pickupTime: e.target.value })} className={inputCls} />
                  </div>
                )}
              </div>
              <label className="flex items-center gap-2 text-sm text-gray-700">
                <input type="checkbox" checked={form.willCall} onChange={e => upd({ willCall: e.target.checked })} />
                Will Call — passenger will call when ready (no scheduled pickup time)
              </label>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className={labelCls} htmlFor="tripType">Trip type *</label>
                  <select id="tripType" value={form.tripType} onChange={e => upd({ tripType: e.target.value })} className={inputCls}>
                    <option value="">Select…</option>
                    {lookups?.tripTypes.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
                  </select>
                </div>
                <div>
                  <label className={labelCls} htmlFor="levelOfService">Level of service *</label>
                  <select id="levelOfService" value={form.levelOfService} onChange={e => upd({ levelOfService: e.target.value })} className={inputCls}>
                    <option value="">Select…</option>
                    {lookups?.levelOfService.map(l => <option key={l.code} value={l.code}>{l.label} ({l.code})</option>)}
                  </select>
                </div>
                <div>
                  <label className={labelCls} htmlFor="additionalPassengers">Additional passengers</label>
                  <input id="additionalPassengers" type="number" min={0} value={form.additionalPassengers}
                    onChange={e => upd({ additionalPassengers: Math.max(0, parseInt(e.target.value, 10) || 0) })} className={inputCls} />
                </div>
                <div>
                  <label className={labelCls} htmlFor="externalRef">External reference</label>
                  <input id="externalRef" type="text" value={form.externalRef} onChange={e => upd({ externalRef: e.target.value })} placeholder="Broker / vendor trip ID" className={inputCls} />
                </div>
              </div>
              <div>
                <label className={labelCls} htmlFor="notes">Notes</label>
                <textarea id="notes" rows={2} value={form.notes} onChange={e => upd({ notes: e.target.value })}
                  placeholder="Operational notes…" className={`${inputCls} resize-none`} />
              </div>
              <label className="flex items-center gap-2 text-sm text-gray-700">
                <input type="checkbox" checked={form.hasReturn} onChange={e => upd({ hasReturn: e.target.checked })} />
                Add return ride
              </label>
              {form.hasReturn && (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pl-6 border-l-2 border-blue-100">
                  <div>
                    <label className={labelCls} htmlFor="returnDate">Return date *</label>
                    <input id="returnDate" type="date" value={form.returnDate} onChange={e => upd({ returnDate: e.target.value })} className={inputCls} />
                  </div>
                  <div>
                    <label className={labelCls} htmlFor="returnTime">Return pickup time *</label>
                    <input id="returnTime" type="time" value={form.returnTime} onChange={e => upd({ returnTime: e.target.value })} className={inputCls} />
                  </div>
                </div>
              )}
            </div>
          )}

          {/* ── Step 3: Addresses ─────────────────────────────────── */}
          {step === 3 && (
            <div className="space-y-4">
              <AddressInput label="Pickup address" value={form.pickup} onChange={a => upd({ pickup: a })} />
              <AddressInput label="Dropoff address" value={form.dropoff} onChange={a => upd({ dropoff: a })} />
            </div>
          )}

          {/* ── Step 4: Review ────────────────────────────────────── */}
          {step === 4 && (
            <div className="space-y-4">
              <dl className="text-sm space-y-1.5 bg-gray-50 rounded-xl p-4">
                <div className="flex gap-2"><dt className="w-32 text-gray-500">Passenger</dt><dd className="font-medium text-gray-800">{passengerName}{form.mode === 'new' ? ' (new)' : ''}</dd></div>
                <div className="flex gap-2"><dt className="w-32 text-gray-500">When</dt><dd className="text-gray-800">{form.serviceDate}{form.willCall ? ' — Will Call' : ` at ${form.pickupTime}`}</dd></div>
                <div className="flex gap-2"><dt className="w-32 text-gray-500">Type / LOS</dt><dd className="text-gray-800">{typeLabel} · {losLabel}</dd></div>
                {form.additionalPassengers > 0 && <div className="flex gap-2"><dt className="w-32 text-gray-500">Add'l passengers</dt><dd className="text-gray-800">{form.additionalPassengers}</dd></div>}
                {form.externalRef && <div className="flex gap-2"><dt className="w-32 text-gray-500">External ref</dt><dd className="text-gray-800">{form.externalRef}</dd></div>}
                <div className="flex gap-2"><dt className="w-32 text-gray-500">Pickup</dt><dd className="text-gray-800">{addrToString(form.pickup)}</dd></div>
                <div className="flex gap-2"><dt className="w-32 text-gray-500">Dropoff</dt><dd className="text-gray-800">{addrToString(form.dropoff)}</dd></div>
                {form.notes && <div className="flex gap-2"><dt className="w-32 text-gray-500">Notes</dt><dd className="text-gray-800">{form.notes}</dd></div>}
                {form.hasReturn && <div className="flex gap-2"><dt className="w-32 text-gray-500">Return leg</dt><dd className="text-gray-800">{form.returnDate} at {form.returnTime} (addresses swapped)</dd></div>}
              </dl>

              {validate.isPending && <p className="text-sm text-gray-500">Validating…</p>}
              {validate.isError && (
                <p className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">Validation failed: {(validate.error as Error).message}</p>
              )}
              {validation?.duplicateWarning && (
                <p className="text-sm text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                  Possible duplicate: trip #{validation.duplicateWarning.tripId} for this passenger already exists on{' '}
                  {new Date(validation.duplicateWarning.scheduledPickupAt).toLocaleDateString()}.
                </p>
              )}
              {validation && validation.issues.length > 0 && (
                <ul className="space-y-1.5">
                  {validation.issues.map((issue, i) => {
                    const meta = issue.field ? FIELD_META[issue.field] : undefined;
                    return (
                      <li key={i} className={`flex items-center justify-between gap-2 text-sm rounded-lg px-3 py-2 ${issue.severity === 'error' ? 'bg-red-50 text-red-700' : 'bg-amber-50 text-amber-800'}`}>
                        <span>
                          <span className="font-medium">{meta?.label ?? issue.field ?? 'General'}:</span> {issue.guidance}
                        </span>
                        {meta && (
                          <button type="button" onClick={() => setStep(meta.step)} className="text-xs underline whitespace-nowrap">
                            Go to step {meta.step}
                          </button>
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}
              {validation && validation.valid && validation.issues.length === 0 && !validation.duplicateWarning && (
                <p className="text-sm text-green-700 bg-green-50 border border-green-200 rounded-lg px-3 py-2">Looks good — no issues found.</p>
              )}
              {createTrip.isError && (
                <p className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">{(createTrip.error as Error).message}</p>
              )}
            </div>
          )}

          {/* ── Footer ────────────────────────────────────────────── */}
          <div className="flex gap-3 pt-2">
            {step > 1 && (
              <button type="button" onClick={() => setStep(s => s - 1)}
                className="flex-1 border border-gray-300 text-gray-700 rounded-lg py-2.5 text-sm font-medium hover:bg-gray-50">
                Back
              </button>
            )}
            <button type="button" onClick={onClose}
              className="flex-1 border border-gray-300 text-gray-700 rounded-lg py-2.5 text-sm font-medium hover:bg-gray-50">
              Cancel
            </button>
            {step < 4 ? (
              <button type="button" onClick={() => setStep(s => s + 1)} disabled={!stepOk(step)}
                className="flex-1 bg-blue-600 hover:bg-blue-700 text-white rounded-lg py-2.5 text-sm font-medium disabled:opacity-50 transition-colors">
                Next
              </button>
            ) : (
              <button type="button" onClick={submit} disabled={submitDisabled}
                className="flex-1 bg-blue-600 hover:bg-blue-700 text-white rounded-lg py-2.5 text-sm font-medium disabled:opacity-50 transition-colors">
                {createTrip.isPending ? 'Creating…' : validate.isPending ? 'Validating…' : 'Create Trip'}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
