export interface LocalParts {
  // 'YYYY-MM-DD' in the time zone, and the same day as a whole number so a run of days is plain subtraction.
  dayKey: string;
  dayNumber: number;
  hour: number;
  minute: number;
  // 0 is Sunday.
  weekday: number;
  dayOfMonth: number;
}

const formatters = new Map<string, Intl.DateTimeFormat>();
const WEEKDAYS: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

function formatterFor(tz: string): Intl.DateTimeFormat {
  let f = formatters.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', weekday: 'short' });
    formatters.set(tz, f);
  }
  return f;
}

// True for a name the platform knows, so a bad ?tz= is refused rather than guessed at.
export function isValidTimeZone(tz: string): boolean {
  try {
    formatterFor(tz);
    return true;
  } catch {
    return false;
  }
}

export function localParts(ms: number, tz: string): LocalParts {
  const parts: Record<string, string> = {};
  for (const p of formatterFor(tz).formatToParts(new Date(ms))) parts[p.type] = p.value;
  const year = Number(parts.year);
  const month = Number(parts.month);
  const dayOfMonth = Number(parts.day);
  return {
    dayKey: `${parts.year}-${parts.month}-${parts.day}`,
    dayNumber: Math.floor(Date.UTC(year, month - 1, dayOfMonth) / 86_400_000),
    hour: Number(parts.hour),
    minute: Number(parts.minute),
    weekday: WEEKDAYS[parts.weekday ?? ''] ?? 0,
    dayOfMonth
  };
}
