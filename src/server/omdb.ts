import type { DetailKey, MediaType } from '../shared/title.ts'
import type { Lookup, LookupResult } from './ports.ts'
import { getJson, LOOKUP_TIMEOUT_MS, LookupUnavailableError } from './lookupError.ts'
import type { FetchLike } from './lookupError.ts'

export interface OmdbOptions {
  apiKey?: string
  fetch?: FetchLike
  now?: () => number
}

const BASE = 'https://www.omdbapi.com/'
// "Response":"False" errors that just mean "no such title".
const EMPTY_ERRORS = new Set(['Movie not found!', 'Series not found!', 'Too many results.', 'Incorrect IMDb ID.'])

function utcDay(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10)
}

function yearOf(s: unknown): number | undefined {
  const m = typeof s === 'string' ? /^\d{4}/.exec(s) : null
  return m ? Number(m[0]) : undefined
}

function str(v: unknown): string | undefined {
  return typeof v === 'string' && v !== '' && v !== 'N/A' ? v : undefined
}

/** "June Halloway, Ines Moreau (original story)" → "June Halloway, Ines Moreau": names only, at most `max`. */
export function people(v: unknown, max: number): string | undefined {
  const names = (str(v) ?? '').split(',').map((n) => n.replace(/\s*\([^)]*\)\s*/g, ' ').trim()).filter(Boolean)
  const unique = [...new Set(names)].slice(0, max)
  return unique.length ? unique.join(', ') : undefined
}

/** OMDb client for movies and shows. Pauses itself until the next UTC day when the daily limit is hit. */
export class OmdbClient implements Lookup {
  private apiKey: string | undefined
  private fetchFn: FetchLike
  private now: () => number
  private pausedOn: string | null = null

  constructor(opts: OmdbOptions = {}) {
    this.apiKey = opts.apiKey
    this.fetchFn = opts.fetch ?? ((url) => fetch(url, { signal: AbortSignal.timeout(LOOKUP_TIMEOUT_MS) }))
    this.now = opts.now ?? Date.now
  }

  /** `detail` is "Movie · 2021" / "Series · 2011–2019": the search endpoint returns no director. */
  async search(type: MediaType, q: string): Promise<LookupResult[]> {
    const omdbType = type === 'show' ? 'series' : 'movie'
    const body = await this.call(`s=${encodeURIComponent(q)}&type=${omdbType}`)
    if (!body) return []
    const rows = Array.isArray(body.Search) ? (body.Search as Record<string, unknown>[]) : []
    const out: LookupResult[] = []
    for (const r of rows) {
      const id = str(r.imdbID)
      const name = str(r.Title)
      if (!id || !name) continue
      const years = str(r.Year)
      out.push({
        source: 'omdb',
        id,
        name,
        year: yearOf(r.Year),
        detail: `${type === 'show' ? 'Series' : 'Movie'}${years ? ` · ${years}` : ''}`,
      })
    }
    return out
  }

  async details(_type: MediaType, id: string): Promise<Partial<Record<DetailKey, string>>> {
    const d = await this.call(`i=${encodeURIComponent(id)}&plot=short`)
    if (!d) return {}
    const out: Partial<Record<DetailKey, string>> = {}
    const imdb = str(d.imdbID)
    if (imdb) out.imdb = imdb
    const year = yearOf(d.Year)
    if (year !== undefined) out.year = String(year)
    const runtime = /^(\d+)\s*min/.exec(str(d.Runtime) ?? '')
    // OMDb has junk episode lengths for some series ("1 min" for some anime); no real episode is under 10 minutes.
    const minutes = runtime?.[1] ? Number(runtime[1]) : undefined
    if (minutes !== undefined && !(d.Type === 'series' && minutes < 10)) out.runtime = String(minutes)
    const genre = str(d.Genre)
    if (genre) out.genre = genre
    const summary = str(d.Plot)
    if (summary) out.summary = summary
    const ratings = Array.isArray(d.Ratings) ? (d.Ratings as Record<string, unknown>[]) : []
    const rt = ratings.find((r) => r.Source === 'Rotten Tomatoes')
    const rtMatch = /^(\d+)%$/.exec(str(rt?.Value) ?? '')
    if (rtMatch?.[1]) out.rt = rtMatch[1]
    const director = people(d.Director, 3)
    if (director) out.director = director
    const writer = people(d.Writer, 4)
    if (writer) out.writer = writer
    const cast = people(d.Actors, 4)
    if (cast) out.cast = cast
    const poster = str(d.Poster)
    if (poster?.startsWith('https://')) out.poster = poster
    return out
  }

  /** Returns the parsed body, or null for "nothing found". Throws LookupUnavailableError for trouble. */
  private async call(query: string): Promise<Record<string, unknown> | null> {
    if (!this.apiKey) throw new LookupUnavailableError('OMDB_API_KEY is not set')
    const today = utcDay(this.now())
    if (this.pausedOn === today) throw new LookupUnavailableError('OMDb daily limit reached; paused until tomorrow (UTC)')
    this.pausedOn = null

    const { ok, status, body } = await getJson(this.fetchFn, `${BASE}?${query}&apikey=${encodeURIComponent(this.apiKey)}`, 'OMDb')
    const data = body && typeof body === 'object' ? (body as Record<string, unknown>) : null
    const error = typeof data?.Error === 'string' ? data.Error : undefined

    if (error === 'Request limit reached!') {
      this.pausedOn = today
      throw new LookupUnavailableError('OMDb daily limit reached')
    }
    if (!data) throw new LookupUnavailableError(`OMDb returned HTTP ${status} with no usable body`)
    if (data.Response === 'False') {
      if (error && EMPTY_ERRORS.has(error)) return null
      throw new LookupUnavailableError(`OMDb error: ${error ?? `HTTP ${status}`}`)
    }
    if (!ok) throw new LookupUnavailableError(`OMDb returned HTTP ${status}`)
    return data
  }
}

export function createOmdbClient(opts: Omit<OmdbOptions, 'apiKey'> & { apiKey?: string } = {}): OmdbClient {
  return new OmdbClient({ ...opts, apiKey: opts.apiKey ?? process.env.OMDB_API_KEY })
}
