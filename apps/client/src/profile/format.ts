export function formatWhen(ms: number, tz: string): string {
  try {
    return new Intl.DateTimeFormat(undefined, { timeZone: tz, year: 'numeric', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }).format(new Date(ms));
  } catch {
    return new Date(ms).toISOString().slice(0, 16).replace('T', ' ');
  }
}

export function formatDay(ms: number, tz: string): string {
  try {
    return new Intl.DateTimeFormat(undefined, { timeZone: tz, year: 'numeric', month: 'short', day: 'numeric' }).format(new Date(ms));
  } catch {
    return new Date(ms).toISOString().slice(0, 10);
  }
}

export function formatPlayed(ms: number): string {
  const minutes = Math.floor(Math.max(0, ms) / 60_000);
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  return `${hours} h ${String(minutes % 60).padStart(2, '0')} min`;
}

export function formatClock(ms: number): string {
  const total = Math.floor(Math.max(0, ms) / 1000);
  return `${Math.floor(total / 60)}m ${String(total % 60).padStart(2, '0')}s`;
}

export const percent = (rate: number | null): string => (rate === null ? 'none yet' : `${Math.round(rate * 100)}%`);
