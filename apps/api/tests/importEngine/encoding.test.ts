import { describe, it, expect } from 'vitest';
import { detectEncoding, decodeCsv } from '../../src/services/importEngine/encoding';

describe('encoding', () => {
  it('detects UTF-8 BOM', () => {
    const buf = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from('a,b\n1,2')]);
    expect(detectEncoding(buf)).toBe('utf-8');
    expect(decodeCsv(buf).text.startsWith('a,b')).toBe(true); // BOM stripped
  });
  it('detects plain UTF-8 with multibyte chars', () => {
    const buf = Buffer.from('name\nJosé', 'utf-8');
    expect(detectEncoding(buf)).toBe('utf-8');
    expect(decodeCsv(buf).text).toContain('José');
  });
  it('falls back to windows-1252 for non-UTF-8 bytes', () => {
    // 0x93/0x94 = curly quotes in cp1252, invalid in UTF-8
    const buf = Buffer.from([0x6e, 0x61, 0x6d, 0x65, 0x0a, 0x93, 0x48, 0x69, 0x94]);
    expect(detectEncoding(buf)).toBe('windows-1252');
    expect(decodeCsv(buf).text).toBe('name\n“Hi”'); // no U+FFFD corruption
  });
});
