import type { ParsedCsv } from './csvParse';

/**
 * Distinct, trimmed, non-empty values for each column (capped per column).
 * Powers the Map step's value-translation editor: it lists the real source
 * values a user needs to translate (e.g. "Door to Door" → "AMB") without having
 * to re-read the file. Order is first-seen.
 */
export function distinctSampleValues(parsed: ParsedCsv, cap = 25): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  const seen: Record<string, Set<string>> = {};
  for (const h of parsed.headers) { out[h] = []; seen[h] = new Set(); }

  for (const row of parsed.rows) {
    for (const h of parsed.headers) {
      if (out[h].length >= cap) continue;
      const v = (row[h] ?? '').trim();
      if (v === '' || seen[h].has(v)) continue;
      seen[h].add(v);
      out[h].push(v);
    }
  }
  return out;
}
