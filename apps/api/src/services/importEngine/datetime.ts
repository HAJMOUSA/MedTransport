import { DateTime } from 'luxon';
import type { VendorProfileConfig } from '@midtransport/shared';

type Cfg = Pick<VendorProfileConfig, 'dateFormat' | 'timeFormat' | 'dateTimeFormat' | 'timezone'>;

export function parseDate(value: string, format: string, tz: string): string | null {
  const v = value.trim();
  if (!v) return null;
  const dt = format === 'iso'
    ? DateTime.fromISO(v, { zone: tz })
    : DateTime.fromFormat(v, format, { zone: tz });
  return dt.isValid ? dt.toISODate() : null;
}

export function parseDateTime(
  parts: { dateTime?: string; date?: string; time?: string },
  config: Cfg
): string | null {
  let dt: DateTime;
  if (parts.dateTime?.trim()) {
    const v = parts.dateTime.trim();
    dt = config.dateTimeFormat === 'iso'
      ? DateTime.fromISO(v, { zone: config.timezone })
      : DateTime.fromFormat(v, config.dateTimeFormat, { zone: config.timezone });
  } else {
    if (!parts.date?.trim()) return null;
    const datePart = DateTime.fromFormat(parts.date.trim(), config.dateFormat, { zone: config.timezone });
    if (!datePart.isValid) return null;
    let hour = 0, minute = 0;
    if (parts.time?.trim()) {
      const t = DateTime.fromFormat(parts.time.trim(), config.timeFormat, { zone: config.timezone });
      if (!t.isValid) return null;
      hour = t.hour; minute = t.minute;
    }
    dt = datePart.set({ hour, minute, second: 0, millisecond: 0 });
  }
  return dt.isValid ? dt.toUTC().toISO() : null;
}
