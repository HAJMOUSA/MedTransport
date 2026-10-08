import { describe, it, expect } from 'vitest';
import { distinctSampleValues } from '../../src/services/importEngine/samples';

describe('distinctSampleValues', () => {
  const parsed = {
    headers: ['Level of Service', 'Passenger Type', 'Empty'],
    rows: [
      { 'Level of Service': 'Door to Door', 'Passenger Type': 'Ambulatory', 'Empty': '' },
      { 'Level of Service': 'Curb to Curb', 'Passenger Type': ' Ambulatory ', 'Empty': '' },
      { 'Level of Service': 'Door to Door', 'Passenger Type': 'Scooter', 'Empty': '' },
    ],
    rowNumbers: [2, 3, 4],
  };

  it('returns distinct, trimmed, non-empty values per column', () => {
    const s = distinctSampleValues(parsed);
    expect(s['Level of Service']).toEqual(['Door to Door', 'Curb to Curb']);
    expect(s['Passenger Type']).toEqual(['Ambulatory', 'Scooter']); // trimmed + deduped
    expect(s['Empty']).toEqual([]); // all blank
  });

  it('caps the number of distinct values per column', () => {
    const rows = Array.from({ length: 50 }, (_, i) => ({ 'Col': `v${i}` }));
    const s = distinctSampleValues({ headers: ['Col'], rows, rowNumbers: rows.map((_, i) => i + 2) }, 10);
    expect(s['Col']).toHaveLength(10);
    expect(s['Col'][0]).toBe('v0');
  });
});
