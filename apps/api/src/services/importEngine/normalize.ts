// C0 controls except \t (\u0009) and \n (\u000A — handled separately for preserveNewlines),
// DEL + C1, soft hyphen, zero-width chars, line/paragraph separators, BOM-as-char.
// Written with explicit escapes: the literal regex contains invisible characters.
const CONTROL_CHARS = /[\u0000-\u0008\u000B-\u001F\u007F-\u009F\u00AD\u200B-\u200F\u2028\u2029\uFEFF]/g;

// Keys written with escapes: curly quotes/dashes are easily mangled by copy-paste.
// \u2018\u2019\u201A = single quotes; \u201C\u201D\u201E = double quotes;
// \u2010\u2011\u2013\u2014 = hyphens/dashes.
const SMART_CHARS: Record<string, string> = {
  '\u2018': "'", '\u2019': "'", '\u201A': "'",
  '\u201C': '"', '\u201D': '"', '\u201E': '"',
  '\u2010': '-', '\u2011': '-', '\u2013': '-', '\u2014': '-',
};
const SMART_CHARS_RE = /[\u2018\u2019\u201A\u201C\u201D\u201E\u2010\u2011\u2013\u2014]/g;

export function normalizeText(value: string, opts?: { preserveNewlines?: boolean }): string {
  let v = value.normalize('NFKC');
  v = v.replace(SMART_CHARS_RE, (ch) => SMART_CHARS[ch] ?? ch);
  // Remove control/zero-width chars outright (replacing with a space would
  // change 'a\u200Bb' into 'a b' instead of 'ab').
  v = v.replace(CONTROL_CHARS, '');
  if (!opts?.preserveNewlines) v = v.replace(/\n/g, ' ');
  return v.replace(/ {2,}/g, ' ').trim();
}

export function normalizeName(value: string): { value: string; suspicious: boolean } {
  const v = normalizeText(value);
  const suspicious = v !== '' && /[^\p{L}\p{M} .'\-]/u.test(v);
  return { value: v, suspicious };
}

export function normalizePhone(value: string): { value: string; valid: boolean } {
  let v = normalizeText(value).replace(/[\s().\-]/g, '');
  const hasPlus = v.startsWith('+');
  v = v.replace(/\+/g, '');
  if (hasPlus) v = '+' + v;
  return { value: v, valid: /^\+?\d{7,15}$/.test(v) };
}

export function normalizeZip(value: string): { value: string; valid: boolean } {
  const v = normalizeText(value).replace(/\s+/g, '');
  return { value: v, valid: /^\d{5}(-\d{4})?$/.test(v) };
}

export function normalizeNumeric(value: string): { value: number | null; ok: boolean } {
  const cleaned = normalizeText(value).replace(/[$,\s]/g, '');
  if (cleaned === '') return { value: null, ok: false };
  const n = Number(cleaned);
  return Number.isFinite(n) && n >= 0 ? { value: n, ok: true } : { value: null, ok: false };
}
