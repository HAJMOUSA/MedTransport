import { describe, it, expect } from 'vitest';
import { parseDate, parseDateTime } from '../../src/services/importEngine/datetime';

const CFG = { dateFormat: 'M/d/yyyy', timeFormat: 'H:mm', dateTimeFormat: 'iso', timezone: 'America/New_York' };

describe('parseDate', () => {
  it('parses US dates per profile format', () => {
    expect(parseDate('9/21/2026', CFG.dateFormat, CFG.timezone)).toBe('2026-09-21');
  });
  it('returns null on garbage', () => {
    expect(parseDate('not a date', CFG.dateFormat, CFG.timezone)).toBeNull();
  });
});
describe('parseDateTime', () => {
  it('combines separate date + time columns, converting to UTC (EDT = UTC-4)', () => {
    expect(parseDateTime({ date: '9/21/2026', time: '8:30' }, CFG)).toBe('2026-09-21T12:30:00.000Z');
  });
  it('respects DST (EST = UTC-5 in January)', () => {
    expect(parseDateTime({ date: '1/15/2026', time: '8:30' }, CFG)).toBe('2026-01-15T13:30:00.000Z');
  });
  it('parses single ISO datetime column', () => {
    expect(parseDateTime({ dateTime: '2026-09-21T08:30:00' }, CFG)).toBe('2026-09-21T12:30:00.000Z');
  });
  it('supports 12-hour time format', () => {
    expect(parseDateTime({ date: '9/21/2026', time: '8:30 AM' }, { ...CFG, timeFormat: 'h:mm a' })).toBe('2026-09-21T12:30:00.000Z');
  });
  it('returns null when date is missing/unparseable', () => {
    expect(parseDateTime({ time: '8:30' }, CFG)).toBeNull();
    expect(parseDateTime({ date: 'bogus', time: '8:30' }, CFG)).toBeNull();
  });
});
