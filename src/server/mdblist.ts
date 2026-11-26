// Rotten Tomatoes scores from MDBList (OMDb stopped carrying them). Used only for the RT score: OMDb still
// supplies everything else. Without MDBLIST_API_KEY, titles simply have no RT.

import type { DetailKey, MediaType, Title } from '../shared/title.ts'
import { getJson, LookupUnavailableError, type FetchLike } from './lookupError.ts'
import type { Lookup, LookupResult } from './ports.ts'
import type { Store } from './store.ts'

/** Answers one title's Tomatometer, 0–100, or undefined when it has none. */
export interface RtSource {
  rt(type: MediaType, imdb: string): Promise<number | undefined>
}

const BASE = 'https://api.mdblist.com'

/** The Tomatometer in an MDBList title: the `ratings` entry whose source is "tomatoes" (not the audience score). */
export function tomatometer(body: unknown): number | undefined {
  const ratings = (body as { ratings?: unknown } | null)?.ratings
  if (!Array.isArray(ratings)) return undefined
  for (const r of ratings as Record<string, unknown>[]) {
    if (String(r?.source ?? '').toLowerCase() !== 'tomatoes') continue
    for (const v of [r.value, r.score]) {
      const n = typeof v === 'number' ? v : typeof v === 'string' && /^\d+(\.\d+)?$/.test(v) ? Number(v) : NaN
      if (Number.isFinite(n) && n >= 0 && n <= 100) return Math.round(n)
    }
  }
  return undefined
}

export class MdblistClient implements RtSource {
  private apiKey: string
  private fetchFn: FetchLike
  private now: () => number
  /** Out of requests until this time (ms): MDBList's limit resets at midnight UTC. */
  private pausedUntil = 0

  constructor(opts: { apiKey: string; fetch?: FetchLike; now?: () => number }) {
    this.apiKey = opts.apiKey
    this.fetchFn = opts.fetch ?? ((url) => fetch(url))
    this.now = opts.now ?? Date.now
  }

  async rt(type: MediaType, imdb: string): Promise<number | undefined> {
    if (this.now() < this.pausedUntil) throw new LookupUnavailableError('MDBList daily limit reached')
    const kind = type === 'show' ? 'show' : 'movie'
    const { ok, status, body } = await getJson(this.fetchFn, `${BASE}/imdb/${kind}/${encodeURIComponent(imdb)}?apikey=${encodeURIComponent(this.apiKey)}`, 'MDBList')
    if (status === 429) {
      const d = new Date(this.now())
      this.pausedUntil = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1)
      throw new LookupUnavailableError('MDBList daily limit reached')
    }
    if (status === 404) return undefined
    if (!ok) throw new LookupUnavailableError(`MDBList answered ${status}`)
    return tomatometer(body)
  }
}

/** MDBList from MDBLIST_API_KEY, or none. */
export function createRtSource(env: Record<string, string | undefined> = process.env): RtSource | null {
  const key = env.MDBLIST_API_KEY?.trim()
  return key ? new MdblistClient({ apiKey: key }) : null
}

/** A lookup whose details carry MDBList's RT when OMDb has none. If MDBList is out, details come back without it. */
export class WithRt implements Lookup {
  private inner: Lookup
  private source: RtSource

  constructor(inner: Lookup, source: RtSource) {
    this.inner = inner
    this.source = source
  }

  search(type: MediaType, q: string): Promise<LookupResult[]> {
    return this.inner.search(type, q)
  }

  async details(type: MediaType, id: string): Promise<Partial<Record<DetailKey, string>>> {
    const d = await this.inner.details(type, id)
    if (d.rt || type === 'game') return d
    try {
      const rt = await this.source.rt(type, d.imdb ?? id)
      return rt === undefined ? d : { ...d, rt: String(rt) }
    } catch (e) {
      if (e instanceof LookupUnavailableError) return d
      throw e
    }
  }
}

export interface RtLibrary {
  listTitles(): Promise<Title[]>
  setFields(pageId: string, fields: { rt: string }): Promise<unknown>
}

/**
 * Fills in RT for library titles and waiting suggestions that have an IMDb id but no score. At most `max`
 * requests per pass; a title MDBList has no score for isn't asked again for a week.
 */
export class RtFiller {
  private library: RtLibrary
  private store: Store
  private source: RtSource
  private now: () => number
  private noScore = new Map<string, number>()

  constructor(library: RtLibrary, store: Store, source: RtSource, now: () => number = Date.now) {
    this.library = library
    this.store = store
    this.source = source
    this.now = now
  }

  private due(imdb: string): boolean {
    const at = this.noScore.get(imdb.toLowerCase())
    return at === undefined || this.now() - at > 7 * 24 * 3600_000
  }

  async runOnce(max = 150): Promise<number> {
    let asked = 0
    let filled = 0
    const ask = async (type: MediaType, imdb: string): Promise<number | undefined> => {
      asked++
      const rt = await this.source.rt(type, imdb)
      if (rt === undefined) this.noScore.set(imdb.toLowerCase(), this.now())
      return rt
    }
    try {
      for (const s of this.store.suggestions('new')) {
        if (asked >= max) return filled
        if (!s.imdb || s.fields.rt || !this.due(s.imdb)) continue
        const rt = await ask(s.type, s.imdb)
        if (rt !== undefined) {
          this.store.updateSuggestion({ ...s, fields: { ...s.fields, rt: String(rt) } })
          filled++
        }
      }
      for (const t of await this.library.listTitles()) {
        if (asked >= max) return filled
        if (t.type === 'game' || !t.imdb || t.rt !== undefined || !this.due(t.imdb)) continue
        const rt = await ask(t.type, t.imdb)
        if (rt !== undefined) {
          await this.library.setFields(t.pageId, { rt: String(rt) })
          filled++
        }
      }
    } catch (e) {
      if (!(e instanceof LookupUnavailableError)) throw e
    }
    return filled
  }
}
