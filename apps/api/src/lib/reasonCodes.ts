// Shared reason codes for trip exception events.
// NOTE: mirrored in apps/mobile/src/lib/reasonCodes.ts — keep both in sync.

export const NO_SHOW_REASON_CODES = [
  'rider_not_present',
  'rider_refused',
  'wrong_address',
  'rider_cancelled_on_arrival',
] as const;

export const CANCELLATION_REASON_CODES = [
  'dispatch_cancelled',
  'duplicate',
  'rider_unreachable',
  'other',
] as const;

export type NoShowReasonCode = (typeof NO_SHOW_REASON_CODES)[number];
export type CancellationReasonCode = (typeof CANCELLATION_REASON_CODES)[number];
