/** Calendar-date helpers. Values are YYYY-MM-DD and are never parsed with UTC ISO strings. */

export type CalendarDate = {
  year: number;
  month: number;
  day: number;
};

export function localTodayISO(now = new Date()): string {
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function parseISODate(value: string): CalendarDate | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  const probe = new Date(Date.UTC(year, month - 1, day));
  if (
    probe.getUTCFullYear() !== year ||
    probe.getUTCMonth() !== month - 1 ||
    probe.getUTCDate() !== day
  ) {
    return null;
  }
  return { year, month, day };
}

export function isRealDate(value: string): boolean {
  return parseISODate(value) !== null;
}

export function compareISODate(a: string, b: string): number | null {
  if (!isRealDate(a) || !isRealDate(b)) return null;
  if (a === b) return 0;
  return a < b ? -1 : 1;
}

/** Whole calendar days from start to end. DST cannot shorten the count. */
export function diffISODays(start: string, end: string): number | null {
  const a = parseISODate(start);
  const b = parseISODate(end);
  if (!a || !b) return null;
  const utcA = Date.UTC(a.year, a.month - 1, a.day);
  const utcB = Date.UTC(b.year, b.month - 1, b.day);
  return Math.round((utcB - utcA) / 86_400_000);
}

export function addISODays(value: string, days: number): string | null {
  const parsed = parseISODate(value);
  if (!parsed || !Number.isFinite(days)) return null;
  const next = new Date(Date.UTC(parsed.year, parsed.month - 1, parsed.day + days));
  const year = next.getUTCFullYear();
  const month = String(next.getUTCMonth() + 1).padStart(2, "0");
  const day = String(next.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function formatDisplayDate(value: string): string {
  const parsed = parseISODate(value);
  if (!parsed) return value;
  const date = new Date(parsed.year, parsed.month - 1, parsed.day);
  return new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(date);
}

/** History stamps are either a date (older records) or a full timestamp the app generated when saving. */
export function formatEventTime(value: string): string {
  if (isRealDate(value)) return formatDisplayDate(value);
  const time = new Date(value);
  if (Number.isNaN(time.getTime())) return value;
  return new Intl.DateTimeFormat("en", { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" }).format(time);
}

export function formatMonthTick(value: string): string {
  const parsed = parseISODate(value);
  if (!parsed) return value;
  const date = new Date(parsed.year, parsed.month - 1, parsed.day);
  return new Intl.DateTimeFormat("en", { month: "short", day: "numeric" }).format(date);
}

export type Daypart = "morning" | "afternoon" | "evening";

export function daypart(now = new Date()): Daypart {
  const hour = now.getHours();
  if (hour < 12) return "morning";
  if (hour < 17) return "afternoon";
  return "evening";
}
