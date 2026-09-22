import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { decodeCsv } from '../../src/services/importEngine/encoding';
import { parseCsv } from '../../src/services/importEngine/csvParse';
import { applyMapping } from '../../src/services/importEngine/mapping';
import { validateRows } from '../../src/services/importEngine/validate';
import { requiredKeys, CANONICAL_FIELDS } from '../../src/services/importEngine/canonical';
import { detectProfile } from '../../src/services/importEngine/profiles';
import { VENDOR_A_PROFILE, VENDOR_B_PROFILE } from '../fixtures/profiles';

const CTX = { levelOfServiceCodes: ['AMB', 'STR', 'WCH'], existingExternalIds: new Set<string>() };
const REQ = requiredKeys([]);

function run(file: string, profile: typeof VENDOR_A_PROFILE) {
  const buf = fs.readFileSync(path.join(__dirname, '../fixtures', file));
  const { text } = decodeCsv(buf);
  const parsed = parseCsv(text);
  const mapped = applyMapping(parsed, profile, 'America/New_York');
  return { parsed, mapped, validated: validateRows(mapped, REQ, CTX) };
}

describe('vendor A pipeline', () => {
  const { mapped, validated } = run('vendor-a.csv', VENDOR_A_PROFILE);
  it('parses 3 rows', () => expect(validated.counts.total).toBe(3));
  it('row 1 valid with trimmed whitespace and correct UTC time', () => {
    const r1 = validated.results[0];
    expect(r1.status).toBe('valid');
    expect(r1.trip.passengerFirstName).toBe('FakeFirst');
    expect(r1.trip.pickupAt).toBe('2026-09-21T12:30:00.000Z');
    expect(r1.trip.medicalId).toBe('0011223344A'); // leading zeroes preserved
    expect(mapped.notices.some(n => /whitespace/i.test(n))).toBe(true);
  });
  it('row 2 invalid: untranslated LOS', () => {
    expect(validated.results[1].issues.some(i => i.code === 'E_CONTROLLED_VALUE')).toBe(true);
  });
  it('row 3 invalid: missing phone + duplicate trip ID in file', () => {
    const codes = validated.results[2].issues.map(i => i.code);
    expect(codes).toContain('E_REQUIRED_FIELD');
    expect(codes).toContain('E_DUPLICATE_IN_FILE');
  });
});

describe('vendor B pipeline', () => {
  const { validated } = run('vendor-b.csv', VENDOR_B_PROFILE);
  it('both rows resolve, ISO datetimes converted to UTC', () => {
    expect(validated.counts.total).toBe(2);
    expect(validated.results[0].trip.pickupAt).toBe('2026-09-21T12:15:00.000Z');
    expect(validated.results[0].trip.levelOfService).toBe('WCH');
  });
});

describe('profile auto-detection', () => {
  it('detects each vendor by headers', () => {
    const candidates = [
      { profileId: 1, versionId: 11, name: 'VendorA', headerSignature: VENDOR_A_PROFILE.headerSignature },
      { profileId: 2, versionId: 21, name: 'VendorB', headerSignature: VENDOR_B_PROFILE.headerSignature },
    ];
    const a = run('vendor-a.csv', VENDOR_A_PROFILE);
    expect(detectProfile(a.parsed.headers, candidates)!.profileId).toBe(1);
    const b = run('vendor-b.csv', VENDOR_B_PROFILE);
    expect(detectProfile(b.parsed.headers, candidates)!.profileId).toBe(2);
  });
});

describe('engine purity', () => {
  it('engine files import no express/pg/redis modules', () => {
    const dir = path.join(__dirname, '../../src/services/importEngine');
    for (const f of fs.readdirSync(dir).filter(f => f.endsWith('.ts'))) {
      const src = fs.readFileSync(path.join(dir, f), 'utf8');
      expect(src, f).not.toMatch(/from '(express|pg|ioredis|\.\.\/\.\.\/db)/);
    }
  });
  it('canonical registry has 19 fields', () => expect(CANONICAL_FIELDS).toHaveLength(19));
});
