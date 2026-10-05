import type { CanonicalTrip, ImportIssue, StructuredAddress, VendorProfileConfig } from '@midtransport/shared';
import { CANONICAL_FIELDS } from './canonical';
import type { ParsedCsv } from './csvParse';
import { isValidTime, parseDate, parseDateTime } from './datetime';
import { makeIssue } from './errors';
import { normalizeName, normalizeNumeric, normalizePhone, normalizeText } from './normalize';

export interface MappingResult {
  trips: CanonicalTrip[];
  rowNumbers: number[];
  issues: ImportIssue[];
  notices: string[];
}

function emptyTrip(): CanonicalTrip {
  return {
    externalTripId: null, willCall: false, appointmentAt: null, pickupAt: null,
    passengerFirstName: null, passengerLastName: null, dateOfBirth: null,
    medicalId: null, primaryPhone: null, alternatePhone: null,
    pickupAddress: null, dropoffAddress: null, levelOfService: null,
    additionalPassengers: 0, assistanceNeeds: null, tripType: null,
    requestedVehicleType: null,
    status: null, distanceMiles: null, notes: null,
  };
}

const CAMEL: Record<string, keyof CanonicalTrip> = {
  external_trip_id: 'externalTripId', will_call: 'willCall', appointment_at: 'appointmentAt', pickup_at: 'pickupAt',
  passenger_first_name: 'passengerFirstName', passenger_last_name: 'passengerLastName',
  date_of_birth: 'dateOfBirth', medical_id: 'medicalId', primary_phone: 'primaryPhone',
  alternate_phone: 'alternatePhone', pickup_address: 'pickupAddress', dropoff_address: 'dropoffAddress',
  level_of_service: 'levelOfService', additional_passengers: 'additionalPassengers',
  assistance_needs: 'assistanceNeeds', trip_type: 'tripType', status: 'status',
  requested_vehicle_type: 'requestedVehicleType',
  distance_miles: 'distanceMiles', notes: 'notes',
};

function translate(config: VendorProfileConfig, key: string, value: string): string {
  const table = config.valueTranslations?.[key];
  if (!table) return value;
  if (table[value] !== undefined) return table[value];
  const ci = Object.keys(table).find(k => k.toLowerCase() === value.toLowerCase());
  return ci !== undefined ? table[ci] : value; // unmatched → raw; validate flags it
}

export function applyMapping(parsed: ParsedCsv, config: VendorProfileConfig, orgTimezone: string): MappingResult {
  const issues: ImportIssue[] = [];
  let trimmedCount = 0;
  const tz = config.timezone || orgTimezone;

  const trips = parsed.rows.map((row, i) => {
    const rowNum = parsed.rowNumbers[i];
    const trip = emptyTrip();
    const dtParts: Record<string, { date?: string; time?: string; dateTime?: string }> = {};
    const addrParts: Record<string, Partial<StructuredAddress>> = {};

    for (const [source, target] of Object.entries(config.columnMap)) {
      const raw = row[source];
      if (raw === undefined || raw.trim() === '') continue;
      if (raw !== raw.trim()) trimmedCount++;
      const [key, suffix] = target.split('.');

      if (suffix === 'date' || suffix === 'time') {
        (dtParts[key] ??= {})[suffix] = raw;
        continue;
      }
      if (['street', 'city', 'state', 'zip'].includes(suffix ?? '')) {
        (addrParts[key] ??= {})[suffix as keyof StructuredAddress] = normalizeText(raw);
        continue;
      }
      if (!suffix && CANONICAL_FIELDS.find(f => f.key === key)?.type === 'datetime') {
        (dtParts[key] ??= {}).dateTime = raw;
        continue;
      }

      // plain mapped value — normalize per canonical type, then translate
      const field = CANONICAL_FIELDS.find(f => f.key === key);
      const prop = CAMEL[key] as keyof CanonicalTrip | undefined;
      if (!field || !prop) continue;
      const v = normalizeText(raw, { preserveNewlines: key === 'notes' });
      const translated = translate(config, key, v);

      switch (field.type) {
        case 'phone': {
          const r = normalizePhone(translated);
          (trip as unknown as Record<string, unknown>)[prop] = r.value || null;
          break;
        }
        case 'integer': case 'decimal': {
          const r = normalizeNumeric(translated);
          (trip as unknown as Record<string, unknown>)[prop] =
            r.ok ? (field.type === 'integer' ? Math.round(r.value!) : r.value) : (translated as unknown); // invalid numbers kept raw → E_NUMERIC_PARSE in validate
          break;
        }
        case 'boolean':
          (trip as unknown as Record<string, unknown>)[prop] = ['true', 'yes', 'y', '1'].includes(translated.toLowerCase());
          break;
        case 'date': {
          const iso = parseDate(translated, config.dateFormat, tz);
          if (iso === null) issues.push(makeIssue(rowNum, null, key, 'E_DATE_PARSE'));
          (trip as unknown as Record<string, unknown>)[prop] = iso;
          break;
        }
        case 'text': {
          if (key === 'passenger_first_name' || key === 'passenger_last_name') {
            const r = normalizeName(v);
            if (r.suspicious) issues.push(makeIssue(rowNum, null, key, 'W_NAME_SUSPICIOUS'));
            (trip as unknown as Record<string, unknown>)[prop] = r.value || null;
          } else {
            (trip as unknown as Record<string, unknown>)[prop] = (translated || null);
          }
          break;
        }
        default:
          (trip as unknown as Record<string, unknown>)[prop] = (translated || null);
      }
    }

    // defaults for unmapped/unset fields
    for (const [key, defVal] of Object.entries(config.defaults ?? {})) {
      const prop = CAMEL[key] as keyof CanonicalTrip | undefined;
      if (!prop) continue;
      const current = trip[prop];
      if (current === null || current === '' ) {
        (trip as unknown as Record<string, unknown>)[prop] = defVal;
      }
    }

    // assemble datetimes
    for (const [key, parts] of Object.entries(dtParts)) {
      const prop = CAMEL[key] as keyof CanonicalTrip;
      const iso = parseDateTime(parts, { ...config, timezone: tz });
      // Will-call trips have no scheduled pickup time — vendors often put a
      // sentinel like "Will Call" in the time column. Don't flag an unparseable
      // pickup/appointment time as an error for them; just leave it null.
      const suppressForWillCall = trip.willCall && (key === 'pickup_at' || key === 'appointment_at');
      if (iso === null && !suppressForWillCall) {
        const badCode =
          !parts.dateTime && parts.time?.trim() && !isValidTime(parts.time, config.timeFormat, tz)
            ? 'E_TIME_PARSE'
            : 'E_DATE_PARSE';
        issues.push(makeIssue(rowNum, trip.externalTripId, key, badCode));
      }
      (trip as unknown as Record<string, unknown>)[prop] = iso;
    }

    // assemble addresses (empty → null)
    for (const [key, parts] of Object.entries(addrParts)) {
      const prop = CAMEL[key] as keyof CanonicalTrip;
      const addr = { street: parts.street ?? '', city: parts.city ?? '', state: parts.state ?? '', zip: parts.zip ?? '' };
      (trip as unknown as Record<string, unknown>)[prop] =
        (addr.street || addr.city || addr.state || addr.zip) ? addr : null;
    }

    // pickup falls back to appointment when not separately mapped
    if (!trip.pickupAt && trip.appointmentAt) trip.pickupAt = trip.appointmentAt;

    return trip;
  });

  // backfill sourceTripId on issues now that trips are built
  trips.forEach((t, i) => {
    const rowNum = parsed.rowNumbers[i];
    for (const issue of issues) {
      if (issue.row === rowNum && issue.sourceTripId === null) issue.sourceTripId = t.externalTripId;
    }
  });

  const notices: string[] = [];
  if (trimmedCount > 0) notices.push(`Trimmed outer whitespace in ${trimmedCount} field${trimmedCount === 1 ? '' : 's'}`);

  return { trips, rowNumbers: parsed.rowNumbers, issues, notices };
}
