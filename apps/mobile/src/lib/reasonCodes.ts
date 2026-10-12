// Mirror of apps/api/src/lib/reasonCodes.ts — keep in sync.
export const NO_SHOW_REASONS: { code: string; label: string }[] = [
  { code: 'rider_not_present', label: 'Rider not present' },
  { code: 'rider_refused', label: 'Rider refused ride' },
  { code: 'wrong_address', label: 'Wrong / bad address' },
  { code: 'rider_cancelled_on_arrival', label: 'Rider cancelled on arrival' },
];

export const CANCELLATION_REASONS: { code: string; label: string }[] = [
  { code: 'dispatch_cancelled', label: 'Cancelled by dispatch' },
  { code: 'duplicate', label: 'Duplicate trip' },
  { code: 'rider_unreachable', label: 'Rider unreachable' },
  { code: 'other', label: 'Other' },
];
