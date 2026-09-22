import type { CanonicalTrip, ImportIssue } from '@midtransport/shared';
import { makeIssue } from './errors';
import type { MappingResult } from './mapping';
import { normalizePhone, normalizeZip } from './normalize';

export interface ValidateContext {
  levelOfServiceCodes: string[];
  existingExternalIds: Set<string>;
}
export interface ValidatedRow {
  row: number;
  trip: CanonicalTrip;
  issues: ImportIssue[];
  status: 'valid' | 'warning' | 'invalid';
}

const RECOGNIZED_STATUSES = new Set(['scheduled', 'cancelled', 'completed', 'no_show']);

const REQUIRED_CHECK: Record<string, (t: CanonicalTrip) => boolean> = {
  external_trip_id: t => !!t.externalTripId,
  pickup_at: t => !!t.pickupAt,
  passenger_first_name: t => !!t.passengerFirstName,
  passenger_last_name: t => !!t.passengerLastName,
  primary_phone: t => !!t.primaryPhone,
  pickup_address: t => !!t.pickupAddress && !!t.pickupAddress.street,
  dropoff_address: t => !!t.dropoffAddress && !!t.dropoffAddress.street,
  level_of_service: t => !!t.levelOfService,
  trip_type: t => !!t.tripType,
};

export function validateRows(
  mapping: MappingResult,
  required: Set<string>,
  ctx: ValidateContext
): {
  results: ValidatedRow[];
  counts: { total: number; valid: number; warning: number; invalid: number; duplicates: number };
  issues: ImportIssue[];
} {
  const seenInFile = new Set<string>();
  const results: ValidatedRow[] = mapping.trips.map((trip, i) => {
    const row = mapping.rowNumbers[i];
    const issues: ImportIssue[] = mapping.issues.filter(is => is.row === row);

    // required fields (will-call trips are exempt from pickup_at)
    for (const key of required) {
      const check = REQUIRED_CHECK[key];
      if (check && !check(trip)) {
        if (key === 'pickup_at' && trip.willCall) continue;
        issues.push(makeIssue(row, trip.externalTripId, key, 'E_REQUIRED_FIELD'));
      }
    }
    // pickup required unless will-call (even if profile overrode required list, this rule stands)
    if (!trip.willCall && !trip.pickupAt && !issues.some(is => is.field === 'pickup_at')) {
      issues.push(makeIssue(row, trip.externalTripId, 'pickup_at', 'E_REQUIRED_FIELD'));
    }
    // phones
    if (trip.primaryPhone && !normalizePhone(trip.primaryPhone).valid) {
      issues.push(makeIssue(row, trip.externalTripId, 'primary_phone', 'E_PHONE_INVALID'));
    }
    if (trip.alternatePhone && !normalizePhone(trip.alternatePhone).valid) {
      issues.push(makeIssue(row, trip.externalTripId, 'alternate_phone', 'E_PHONE_INVALID'));
    }
    // zips
    if (trip.pickupAddress?.zip && !normalizeZip(trip.pickupAddress.zip).valid) {
      issues.push(makeIssue(row, trip.externalTripId, 'pickup_address', 'E_ZIP_INVALID'));
    }
    if (trip.dropoffAddress?.zip && !normalizeZip(trip.dropoffAddress.zip).valid) {
      issues.push(makeIssue(row, trip.externalTripId, 'dropoff_address', 'E_ZIP_INVALID'));
    }
    // numerics left raw by mapping (string where number expected)
    if (typeof trip.distanceMiles === 'string' || typeof trip.additionalPassengers === 'string') {
      const field = typeof trip.distanceMiles === 'string' ? 'distance_miles' : 'additional_passengers';
      issues.push(makeIssue(row, trip.externalTripId, field, 'E_NUMERIC_PARSE'));
      if (typeof trip.distanceMiles === 'string') trip.distanceMiles = null;
      if (typeof trip.additionalPassengers === 'string') trip.additionalPassengers = 0;
    }
    if (typeof trip.additionalPassengers === 'number' && trip.additionalPassengers < 0) {
      issues.push(makeIssue(row, trip.externalTripId, 'additional_passengers', 'E_NUMERIC_PARSE'));
      trip.additionalPassengers = 0;
    }
    // controlled values
    if (trip.levelOfService && !ctx.levelOfServiceCodes.includes(trip.levelOfService)) {
      issues.push(makeIssue(row, trip.externalTripId, 'level_of_service', 'E_CONTROLLED_VALUE'));
    }
    // status: recognized subset, else warning + null (imports as scheduled)
    if (trip.status && !RECOGNIZED_STATUSES.has(trip.status)) {
      issues.push(makeIssue(row, trip.externalTripId, 'status', 'W_STATUS_UNKNOWN'));
      trip.status = null;
    }
    // duplicates
    if (trip.externalTripId) {
      if (seenInFile.has(trip.externalTripId)) {
        issues.push(makeIssue(row, trip.externalTripId, 'external_trip_id', 'E_DUPLICATE_IN_FILE'));
      }
      seenInFile.add(trip.externalTripId);
      if (ctx.existingExternalIds.has(trip.externalTripId)) {
        issues.push(makeIssue(row, trip.externalTripId, 'external_trip_id', 'E_DUPLICATE_IN_DB'));
      }
    }

    const hasError = issues.some(is => is.severity === 'error');
    const status: ValidatedRow['status'] = hasError ? 'invalid' : issues.length > 0 ? 'warning' : 'valid';
    return { row, trip, issues, status };
  });

  const issues = results.flatMap(r => r.issues);
  return {
    results,
    issues,
    counts: {
      total: results.length,
      valid: results.filter(r => r.status === 'valid').length,
      warning: results.filter(r => r.status === 'warning').length,
      invalid: results.filter(r => r.status === 'invalid').length,
      duplicates: results.filter(r => r.issues.some(i => i.code === 'E_DUPLICATE_IN_FILE' || i.code === 'E_DUPLICATE_IN_DB')).length,
    },
  };
}
