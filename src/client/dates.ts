import { localDate } from '../shared/localDate.ts'

/** Today's date in the local time zone as YYYY-MM-DD (the server's rule for `finished`). */
export function todayLocal(now: Date = new Date()): string {
  return localDate(now)
}

/** "2026-10-18" -> "Oct 18, 2026". Anything else comes back as it was. */
export function formatDate(ymd: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(ymd)) return ymd
  const d = new Date(`${ymd}T12:00:00Z`)
  if (Number.isNaN(d.getTime())) return ymd
  return new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', month: 'short', day: 'numeric', year: 'numeric' }).format(d)
}
