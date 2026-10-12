// Canonical trip import types — shared between API and web (type-only).
export interface StructuredAddress {
  street: string;
  city: string;
  state: string;
  zip: string;
}

export interface CanonicalTrip {
  externalTripId: string | null;
  willCall: boolean;
  appointmentAt: string | null;      // ISO 8601 with offset
  pickupAt: string | null;           // ISO 8601 with offset; null allowed when willCall
  passengerFirstName: string | null;
  passengerLastName: string | null;
  dateOfBirth: string | null;        // YYYY-MM-DD
  medicalId: string | null;
  primaryPhone: string | null;       // digits + optional leading +
  alternatePhone: string | null;
  pickupAddress: StructuredAddress | null;
  dropoffAddress: StructuredAddress | null;
  levelOfService: string | null;     // org levels_of_service.code
  additionalPassengers: number;
  assistanceNeeds: string | null;
  tripType: string | null;
  requestedVehicleType: string | null; // free text: vendor-requested vehicle/space type
  status: string | null;             // maps onto trip_status enum subset
  distanceMiles: number | null;
  notes: string | null;
}

export interface VendorProfileConfig {
  headerSignature: string[];                          // exact source headers, order as uploaded
  columnMap: Record<string, string>;                  // source header → canonical key (datetime: '.date'/'.time' suffix; addresses: '.street'/'.city'/'.state'/'.zip' suffix)
  encoding: 'utf-8' | 'windows-1252' | 'auto';
  delimiter: string;                                  // ',' supported
  dateFormat: string;                                 // luxon tokens, e.g. 'M/d/yyyy'
  timeFormat: string;                                 // e.g. 'H:mm' or 'h:mm a'
  dateTimeFormat: string;                             // e.g. "yyyy-MM-dd'T'HH:mm:ss" or 'iso'
  timezone: string;                                   // IANA, e.g. 'America/New_York'
  valueTranslations: Record<string, Record<string, string>>; // canonicalKey → { sourceValue → targetValue }
  defaults: Record<string, string>;                   // canonicalKey → literal default
  requiredOverrides: string[];                        // canonical keys forced optional
}

export type ImportErrorCode =
  | 'E_REQUIRED_FIELD' | 'E_UNMAPPED_REQUIRED' | 'E_DATE_PARSE' | 'E_TIME_PARSE'
  | 'E_PHONE_INVALID' | 'E_ZIP_INVALID' | 'E_CONTROLLED_VALUE'
  | 'E_DUPLICATE_IN_FILE' | 'E_DUPLICATE_IN_DB' | 'E_NUMERIC_PARSE'
  | 'W_NAME_SUSPICIOUS' | 'W_STATUS_UNKNOWN';

export interface ImportIssue {
  row: number;                       // 1-based data row (header = row 0 conceptually; first data row = 2 in file terms — see engine note)
  sourceTripId: string | null;
  field: string | null;              // canonical key
  code: ImportErrorCode;
  guidance: string;
  severity: 'error' | 'warning';
}

export type ImportMode = 'test' | 'all_or_nothing' | 'valid_rows_only';
export type DuplicatePolicy = 'skip' | 'reject' | 'update';
