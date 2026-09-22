import { describe, it, expect } from 'vitest';
import { normalizeText, normalizeName, normalizePhone, normalizeZip, normalizeNumeric } from '../../src/services/importEngine/normalize';

describe('normalizeText', () => {
  it('trims, collapses whitespace, strips control/zero-width chars', () => {
    expect(normalizeText('  hello   world ')).toBe('hello world');
    // zero-width space (U+200B) + BOM-as-char (U+FEFF) — escapes used to avoid invisible literals
    expect(normalizeText('a\u200Bb\uFEFFc')).toBe('abc');
  });
  it('converts curly quotes to stable equivalents', () => {
    // O + U+2019, U+201C/U+201D curly double quotes
    expect(normalizeText('O\u2019Brien \u201Cok\u201D')).toBe(`O'Brien "ok"`);
  });
  it('preserves newlines only when asked', () => {
    expect(normalizeText('a\nb')).toBe('a b');
    expect(normalizeText('a\nb', { preserveNewlines: true })).toBe('a\nb');
  });
});
describe('normalizeName', () => {
  it('preserves apostrophes, hyphens, periods', () => {
    expect(normalizeName("O'Brien-Smith Jr.")).toEqual({ value: "O'Brien-Smith Jr.", suspicious: false });
  });
  it('flags digits/symbols as suspicious without altering', () => {
    const r = normalizeName('Mary123');
    expect(r).toEqual({ value: 'Mary123', suspicious: true });
  });
});
describe('normalizePhone', () => {
  it('strips punctuation, keeps one leading +', () => {
    expect(normalizePhone('(313) 555-1234')).toEqual({ value: '3135551234', valid: true });
    expect(normalizePhone('+1 (313) 555-1234')).toEqual({ value: '+13135551234', valid: true });
  });
  it('rejects too-short and letter values', () => {
    expect(normalizePhone('123').valid).toBe(false);
    expect(normalizePhone('call me').valid).toBe(false);
  });
});
describe('normalizeZip', () => {
  it('accepts 5 and ZIP+4, preserves leading zeroes', () => {
    expect(normalizeZip(' 02134 ')).toEqual({ value: '02134', valid: true });
    expect(normalizeZip('62701-1234').valid).toBe(true);
    expect(normalizeZip('6270').valid).toBe(false);
    expect(normalizeZip('6270A').valid).toBe(false);
  });
});
describe('normalizeNumeric', () => {
  it('strips currency and thousands separators', () => {
    expect(normalizeNumeric('$1,234.50')).toEqual({ value: 1234.5, ok: true });
    expect(normalizeNumeric('0')).toEqual({ value: 0, ok: true });
  });
  it('rejects non-numeric and negative', () => {
    expect(normalizeNumeric('abc').ok).toBe(false);
    expect(normalizeNumeric('-3').ok).toBe(false);
  });
});
