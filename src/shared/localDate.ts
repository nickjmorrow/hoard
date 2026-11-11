// The calendar day rule for `finished`: the day in the local time zone (the TZ variable, else the system's).

const fmt = () => new Intl.DateTimeFormat('en-CA', { year: 'numeric', month: '2-digit', day: '2-digit' })

/** `ms` (or a Date) as YYYY-MM-DD in the local time zone. */
export function localDate(ms: number | Date = Date.now()): string {
  const p = Object.fromEntries(fmt().formatToParts(ms).map((x) => [x.type, x.value]))
  return `${p.year}-${p.month}-${p.day}`
}
