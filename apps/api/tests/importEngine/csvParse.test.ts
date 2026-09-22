import { describe, it, expect } from 'vitest';
import { parseCsv, CsvStructureError } from '../../src/services/importEngine/csvParse';

describe('parseCsv', () => {
  it('parses RFC 4180 quoting: commas, quotes, line breaks', () => {
    const { rows } = parseCsv('name,note\n"Doe, Jane","said ""hi""\nbye"\nSmith,plain');
    expect(rows[0].name).toBe('Doe, Jane');
    expect(rows[0].note).toBe('said "hi"\nbye');
    expect(rows[1].name).toBe('Smith');
  });
  it('skips blank rows and tracks source line numbers', () => {
    const { rows, rowNumbers } = parseCsv('a,b\n1,2\n\n3,4\n');
    expect(rows).toHaveLength(2);
    expect(rowNumbers).toEqual([2, 4]);
  });
  it('rejects duplicate headers', () => {
    expect(() => parseCsv('a,a\n1,2')).toThrow(CsvStructureError);
  });
  it('rejects blank header names', () => {
    expect(() => parseCsv('a,,c\n1,2,3')).toThrow(CsvStructureError);
  });
  it('enforces the row limit', () => {
    const big = 'a\n' + Array(10001).fill('x').join('\n');
    expect(() => parseCsv(big)).toThrow(/10,000/);
  });
});
