import Papa from 'papaparse';

export class CsvStructureError extends Error {
  constructor(message: string) { super(message); this.name = 'CsvStructureError'; }
}

export interface ParsedCsv {
  headers: string[];
  rows: Record<string, string>[];
  rowNumbers: number[];
}

export function parseCsv(text: string, maxRows = 10_000): ParsedCsv {
  // Collect every raw record with its 1-based source line. Papaparse's
  // `meta.cursor` is the offset just past each record, so counting line
  // breaks in the consumed span keeps line numbers accurate even when blank
  // lines or quoted multi-line fields occur between records.
  const rawRecords: string[][] = [];
  const rawLines: number[] = [];
  let cursor = 0;
  let line = 1;
  Papa.parse<string[]>(text, {
    header: false,
    step: (results) => {
      rawRecords.push(results.data);
      rawLines.push(line);
      const consumed = text.slice(cursor, results.meta.cursor);
      line += (consumed.match(/\r\n|\r|\n/g) ?? []).length;
      cursor = results.meta.cursor;
    },
  });

  // Drop blank rows (same rule as papaparse's skipEmptyLines: 'greedy'),
  // keeping each surviving record's true source line.
  const records: string[][] = [];
  const recordLines: number[] = [];
  rawRecords.forEach((rec, i) => {
    if (rec.join('').trim() === '') return;
    records.push(rec);
    recordLines.push(rawLines[i]);
  });

  if (records.length < 1) throw new CsvStructureError('File is empty');

  const headers = records[0].map(h => h.trim());
  if (headers.some(h => h === '')) throw new CsvStructureError('File has blank column header names');
  const seen = new Set<string>();
  for (const h of headers) {
    if (seen.has(h)) throw new CsvStructureError(`Duplicate column header: "${h}"`);
    seen.add(h);
  }

  const dataRecords = records.slice(1);
  if (dataRecords.length > maxRows) {
    throw new CsvStructureError(`File has ${dataRecords.length} rows; the limit is 10,000 rows`);
  }

  const rows: Record<string, string>[] = [];
  const rowNumbers: number[] = [];
  dataRecords.forEach((rec, i) => {
    const obj: Record<string, string> = {};
    headers.forEach((h, j) => { obj[h] = rec[j] ?? ''; });
    rows.push(obj);
    rowNumbers.push(recordLines[i + 1]); // header = line 1
  });
  return { headers, rows, rowNumbers };
}
