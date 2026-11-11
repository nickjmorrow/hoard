import type { Availability } from './ports.ts'

export interface JellyfinItem {
  imdb: string
  played: boolean
  lastPlayed?: string
  /** Jellyfin's name, year and kind: used to fill a title's missing IMDb ID (jellyfinMatch.ts). */
  /** Jellyfin's own item id (what the Apple apps ask Jellyfin to play). */
  id?: string
  name?: string
  year?: number
  kind?: 'movie' | 'show'
}

interface RawItem {
  Id?: unknown
  Type?: unknown
  Name?: unknown
  ProductionYear?: unknown
  SeriesId?: unknown
  ProviderIds?: { Imdb?: unknown }
  UserData?: { Played?: unknown; LastPlayedDate?: unknown }
}

export interface JellyfinOptions { url: string; apiKey: string; fetch?: typeof globalThis.fetch; timeoutMs?: number }

function lastPlayedMs(i: JellyfinItem): number {
  const n = i.lastPlayed ? Date.parse(i.lastPlayed) : NaN
  return Number.isNaN(n) ? -Infinity : n
}

/** True when `a` should replace `b` for the same IMDb id: played first, then the latest last-played. */
function better(a: JellyfinItem, b: JellyfinItem): boolean {
  if (a.played !== b.played) return a.played
  return lastPlayedMs(a) > lastPlayedMs(b)
}

/** Which titles are on the server's Jellyfin, and what has been played. Unknown (null) whenever Jellyfin is unreachable. */
export class Jellyfin implements Availability {
  private url: string
  private apiKey: string
  private fetchFn: typeof globalThis.fetch | undefined
  private timeoutMs: number
  private userId: string | null = null
  private wasDown = false
  private index: Map<string, JellyfinItem> | null = null

  constructor(opts: JellyfinOptions) {
    this.url = opts.url.replace(/\/+$/, '')
    this.apiKey = opts.apiKey
    this.fetchFn = opts.fetch
    this.timeoutMs = opts.timeoutMs ?? 10_000
  }

  /** Reloads from Jellyfin. Returns false (and reports down) on any failure; never throws. */
  async refresh(): Promise<boolean> {
    if (!this.url || !this.apiKey) return false
    try {
      if (!this.userId) {
        const users = await this.get('/Users')
        const id = Array.isArray(users) ? (users[0] as { Id?: unknown } | undefined)?.Id : undefined
        if (typeof id !== 'string' || !id) throw new Error('no Jellyfin users')
        this.userId = id
      }
      const body = await this.get(
        `/Users/${this.userId}/Items?IncludeItemTypes=Movie,Series&Recursive=true&Fields=ProviderIds,UserData`,
      )
      const raw = (body as { Items?: unknown } | null)?.Items
      if (!Array.isArray(raw)) throw new Error('unexpected Jellyfin response')
      const parsed: JellyfinItem[] = []
      const pending = new Map<string, JellyfinItem[]>() // played Series without a play date, by Series Id
      for (const r of raw as RawItem[]) {
        const imdb = r?.ProviderIds?.Imdb
        if (typeof imdb !== 'string' || !imdb.trim()) continue
        const item: JellyfinItem = { imdb, played: r.UserData?.Played === true }
        if (typeof r.Id === 'string' && r.Id) item.id = r.Id
        if (typeof r.Name === 'string' && r.Name) item.name = r.Name
        if (typeof r.ProductionYear === 'number') item.year = r.ProductionYear
        if (r.Type === 'Movie') item.kind = 'movie'
        else if (r.Type === 'Series') item.kind = 'show'
        const lp = r.UserData?.LastPlayedDate
        if (typeof lp === 'string' && lp) item.lastPlayed = lp
        else if (item.played && r.Type === 'Series' && typeof r.Id === 'string' && r.Id) {
          const list = pending.get(r.Id) ?? []
          list.push(item)
          pending.set(r.Id, list)
        }
        parsed.push(item)
      }
      if (pending.size > 0) {
        // Series items carry no LastPlayedDate; the latest played episode's date stands in for it.
        const eps = await this.get(
          `/Users/${this.userId}/Items?IncludeItemTypes=Episode&IsPlayed=true&Recursive=true&Fields=UserData`,
        )
        const epItems = (eps as { Items?: unknown } | null)?.Items
        if (!Array.isArray(epItems)) throw new Error('unexpected Jellyfin response')
        const latest = new Map<string, string>()
        for (const e of epItems as RawItem[]) {
          const sid = e?.SeriesId
          const d = e?.UserData?.LastPlayedDate
          if (typeof sid !== 'string' || !pending.has(sid) || typeof d !== 'string' || !d) continue
          const cur = latest.get(sid)
          if (cur === undefined || Date.parse(d) > Date.parse(cur)) latest.set(sid, d)
        }
        for (const [sid, d] of latest) for (const item of pending.get(sid) ?? []) item.lastPlayed = d
      }
      const index = new Map<string, JellyfinItem>()
      for (const item of parsed) {
        const key = item.imdb.toLowerCase()
        const prev = index.get(key)
        if (!prev || better(item, prev)) index.set(key, item)
      }
      this.index = index
      if (this.wasDown) console.error('jellyfin: back up')
      this.wasDown = false
      return true
    } catch (e) {
      this.index = null
      this.userId = null
      if (!this.wasDown) console.error(`jellyfin: down: ${e instanceof Error ? e.message : String(e)}`)
      this.wasDown = true
      return false
    }
  }

  isUp(): boolean { return this.index !== null }

  onEdgar(imdb: string): boolean | null {
    if (!this.index) return null
    return this.index.has(imdb.toLowerCase())
  }

  /** Jellyfin's item id for this IMDb id, or null when it isn't on the server or Jellyfin can't say. */
  jellyfinId(imdb: string): string | null {
    return this.index?.get(imdb.toLowerCase())?.id ?? null
  }

  items(): JellyfinItem[] { return this.index ? [...this.index.values()] : [] }

  private async get(path: string): Promise<unknown> {
    const f = this.fetchFn ?? globalThis.fetch
    const res = await f(`${this.url}${path}`, { signal: AbortSignal.timeout(this.timeoutMs), headers: { Authorization: `MediaBrowser Token="${this.apiKey}"` } })
    if (!res.ok) throw new Error(`HTTP ${res.status} for ${path.split('?')[0]}`)
    return res.json()
  }
}

/** Builds a Jellyfin from JELLYFIN_URL and JELLYFIN_API_KEY; with either missing it just reports down. */
export function createJellyfin(): Jellyfin {
  return new Jellyfin({ url: process.env.JELLYFIN_URL ?? '', apiKey: process.env.JELLYFIN_API_KEY ?? '' })
}
