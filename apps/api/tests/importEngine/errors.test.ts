import { describe, it, expect } from 'vitest';
import { ERROR_GUIDANCE, ERROR_SEVERITY, makeIssue } from '../../src/services/importEngine/errors';
import type { ImportErrorCode } from '@midtransport/shared';

const ALL_CODES: ImportErrorCode[] = [
  'E_REQUIRED_FIELD','E_UNMAPPED_REQUIRED','E_DATE_PARSE','E_TIME_PARSE','E_PHONE_INVALID',
  'E_ZIP_INVALID','E_CONTROLLED_VALUE','E_DUPLICATE_IN_FILE','E_DUPLICATE_IN_DB',
  'E_NUMERIC_PARSE','W_NAME_SUSPICIOUS','W_STATUS_UNKNOWN',
];

describe('error registry', () => {
  it('has guidance and severity for every code', () => {
    for (const c of ALL_CODES) {
      expect(ERROR_GUIDANCE[c].length).toBeGreaterThan(10);
      expect(['error','warning']).toContain(ERROR_SEVERITY[c]);
    }
  });
  it('makeIssue stamps severity from the registry', () => {
    const issue = makeIssue(5, 'T-1', 'primary_phone', 'E_PHONE_INVALID');
    expect(issue).toMatchObject({ row: 5, sourceTripId: 'T-1', field: 'primary_phone', severity: 'error' });
    expect(issue.guidance).toBe(ERROR_GUIDANCE.E_PHONE_INVALID);
  });
});
