export type CsvEncoding = 'utf-8' | 'windows-1252';

export function detectEncoding(buf: Buffer): CsvEncoding {
  if (buf.length >= 3 && buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) return 'utf-8';
  try {
    new TextDecoder('utf-8', { fatal: true }).decode(buf);
    return 'utf-8';
  } catch {
    return 'windows-1252';
  }
}

export function decodeCsv(buf: Buffer): { text: string; encoding: CsvEncoding } {
  const encoding = detectEncoding(buf);
  const text = new TextDecoder(encoding).decode(buf);
  return { text: text.replace(/^\uFEFF/, ''), encoding };
}
