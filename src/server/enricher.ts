import type { DetailKey, FieldKey, Title } from '../shared/title.ts'
import type { Lookup, LookupResult } from './ports.ts'
import { LookupUnavailableError } from './lookupError.ts'
import type { TitleStore } from './titleStore.ts'

type Fields = Partial<Record<DetailKey, string>>
type Outcome = 'filled' | 'unsure' | 'nothing'

export function normalizeName(s: string): string {
  return s
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
}

/** The one search result that clearly is this title, or null. */
export function clearMatch(t: Title, results: LookupResult[]): LookupResult | null {
  const want = normalizeName(t.name)
  if (!want) return null
  const hits = results.filter((r) => {
    if (normalizeName(r.name) !== want) return false
    if (t.year === undefined) return true
    return r.year !== undefined && Math.abs(r.year - t.year) <= 1
  })
  return hits.length === 1 ? (hits[0] ?? null) : null
}

function isCandidate(t: Title): boolean {
  if (t.type === 'game') return false
  return !t.imdb || t.year === undefined || t.runtime === undefined || !t.genre?.length || !t.summary ||
    (t.type === 'movie' && !t.director?.length) || !t.writer?.length || !t.cast?.length || !t.poster
}

function missingFields(t: Title, found: Fields): Partial<Record<FieldKey, string>> {
  const has: Partial<Record<FieldKey, boolean>> = {
    imdb: !!t.imdb,
    year: t.year !== undefined,
    runtime: t.runtime !== undefined,
    genre: !!t.genre?.length,
    rt: t.rt !== undefined,
    summary: !!t.summary,
    director: !!t.director?.length,
    writer: !!t.writer?.length,
    cast: !!t.cast?.length,
  }
  const out: Partial<Record<FieldKey, string>> = {}
  for (const key of Object.keys(has) as FieldKey[]) {
    const v = found[key]
    if (v && !has[key]) out[key] = v
  }
  return out
}

/** Fills missing title properties from OMDb, never overwriting existing values. */
export class Enricher {
  private g: TitleStore
  private l: Lookup
  private now: () => number
  private memo = new Map<string, number>()
  /** Gets each poster URL found; posters go to Hoard's store, never onto a page. */
  onPoster: (imdb: string, url: string) => void = () => {}
  private running = false
  private timer: ReturnType<typeof setInterval> | null = null
  lastRunAt: number | null = null

  constructor(g: TitleStore, l: Lookup, now: () => number = Date.now) {
    this.g = g
    this.l = l
    this.now = now
  }

  async runOnce(): Promise<{ filled: number; unsure: number }> {
    let filled = 0
    let unsure = 0
    let skipped = 0
    let skipReason = ''
    for (const t of await this.g.listTitles()) {
      if (!isCandidate(t) || this.memo.get(t.pageId) === t.updatedAt) continue
      try {
        const outcome = await this.attempt(t)
        if (outcome === 'filled') filled++
        else if (outcome === 'unsure') unsure++
      } catch (e) {
        // Transient: not memoized, so the next run retries it.
        if (e instanceof LookupUnavailableError) {
          skipped++
          skipReason = e.message
        } else {
          console.error(`enricher: ${t.pageTitle}: ${e instanceof Error ? e.message : String(e)}`)
        }
      }
    }
    if (skipped > 0) console.error(`enricher: lookup unavailable (${skipReason}), skipped ${skipped} titles`)
    this.lastRunAt = this.now()
    return { filled, unsure }
  }

  /** Enrich one page now, ignoring the retry memo. Never rejects: errors are logged. */
  async enrichNow(pageId: string): Promise<void> {
    try {
      const t = await this.g.getTitle(pageId)
      if (t && isCandidate(t)) await this.attempt(t)
    } catch (e) {
      console.error(`enricher: ${pageId}: ${e instanceof Error ? e.message : String(e)}`)
    }
  }

  start(intervalMs = 300_000): void {
    if (this.timer) return
    const tick = () => {
      if (this.running) return
      this.running = true
      this.runOnce()
        .catch((e) => console.error('enricher: run failed', e))
        .finally(() => { this.running = false })
    }
    tick()
    this.timer = setInterval(tick, intervalMs)
    this.timer.unref()
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
  }

  private async attempt(t: Title): Promise<Outcome> {
    let found: Fields
    if (t.imdb) {
      found = await this.l.details(t.type, t.imdb)
    } else {
      const m = clearMatch(t, await this.l.search(t.type, t.name))
      if (!m) {
        this.memo.set(t.pageId, t.updatedAt)
        return 'unsure'
      }
      found = await this.l.details(t.type, m.id)
      if (t.type === 'movie' || t.type === 'show') found = { imdb: m.id, ...found }
    }

    const imdb = found.imdb ?? t.imdb
    if (found.poster && imdb) this.onPoster(imdb, found.poster)

    // The run can take minutes: re-read so we never overwrite what changed since the snapshot.
    const fresh = await this.g.getTitle(t.pageId)
    if (!fresh) return 'nothing'
    const fields = missingFields(fresh, found)
    if (Object.keys(fields).length === 0) {
      this.memo.set(t.pageId, fresh.updatedAt)
      return 'nothing'
    }
    const updated = await this.g.setFields(t.pageId, fields)
    this.memo.set(t.pageId, updated.updatedAt)
    return 'filled'
  }
}
