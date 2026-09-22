import type { ImportErrorCode, ImportIssue } from '@midtransport/shared';

export const ERROR_GUIDANCE: Record<ImportErrorCode, string> = {
  E_REQUIRED_FIELD: 'This field is required. Add a value in the source file or map a column that provides it.',
  E_UNMAPPED_REQUIRED: 'A required field has no mapped source column. Update the vendor profile mapping.',
  E_DATE_PARSE: 'Date could not be parsed with the profile date format. Fix the value or adjust the profile.',
  E_TIME_PARSE: 'Time could not be parsed with the profile time format. Fix the value or adjust the profile.',
  E_PHONE_INVALID: 'Phone number must contain 7-15 digits, optionally starting with +. Check the source value.',
  E_ZIP_INVALID: 'ZIP code must be 5 digits or ZIP+4 (e.g. 62701 or 62701-1234).',
  E_CONTROLLED_VALUE: 'Value is not in the profile translation table. Add a translation or fix the source value.',
  E_DUPLICATE_IN_FILE: 'This external trip ID appears more than once in the file. Remove the duplicate row.',
  E_DUPLICATE_IN_DB: 'A trip with this vendor trip ID was already imported. Choose a skip, reject, or update policy.',
  E_NUMERIC_PARSE: 'Expected a non-negative number. Remove non-numeric text from the value.',
  W_NAME_SUSPICIOUS: 'Name contains digits or unusual symbols. Verify it was not corrupted during export.',
  W_STATUS_UNKNOWN: 'Status value not recognized; the trip will import as Scheduled. Add a translation to map it.',
};

export const ERROR_SEVERITY: Record<ImportErrorCode, 'error' | 'warning'> = {
  E_REQUIRED_FIELD: 'error', E_UNMAPPED_REQUIRED: 'error', E_DATE_PARSE: 'error',
  E_TIME_PARSE: 'error', E_PHONE_INVALID: 'error', E_ZIP_INVALID: 'error',
  E_CONTROLLED_VALUE: 'error', E_DUPLICATE_IN_FILE: 'error', E_DUPLICATE_IN_DB: 'error',
  E_NUMERIC_PARSE: 'error', W_NAME_SUSPICIOUS: 'warning', W_STATUS_UNKNOWN: 'warning',
};

export function makeIssue(
  row: number, sourceTripId: string | null, field: string | null, code: ImportErrorCode
): ImportIssue {
  return { row, sourceTripId, field, code, guidance: ERROR_GUIDANCE[code], severity: ERROR_SEVERITY[code] };
}
