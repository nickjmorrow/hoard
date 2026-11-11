import { describe, expect, it, vi } from 'vitest'
import type { FieldKey, Title } from '../shared/title.ts'
import { Enricher } from './enricher.ts'
import { LookupUnavailableError } from './lookupError.ts'
import { OmdbClient } from './omdb.ts'
import { RoutingLookup } from './lookup.ts'
import type { Lookup, LookupResult } from './ports.ts'
import type { TitleStore } from './titleStore.ts'

function title(over: Partial<Title>): Title {
  return {
    pageId: 'p1', pageTitle: over.name ?? 'Starfall', name: 'Starfall', type: 'movie', status: 'want', tags: [],
    notesText: '', updatedAt: 1000, createdAt: 1, ...over,
  }
}

class FakeStore implements TitleStore {
  writes: { pageId: string; fields: Partial<Record<FieldKey, string | null>> }[] = []
  titles: Title[]
  constructor(titles: Title[]) { this.titles = titles }
  async listTitles() { return this.titles }
  async getTitle(id: string) { return this.titles.find((t) => t.pageId === id) ?? null }
  async setFields(pageId: string, fields: Partial<Record<FieldKey, string | null>>) {
    this.writes.push({ pageId, fields })
    const t = this.titles.find((x) => x.pageId === pageId)!
    t.updatedAt += 1
    return t
  }
}

const starfallDetails = { imdb: 'tt1000419', year: '2021', runtime: '155', genre: 'Action, Adventure, Drama', rt: '83', summary: 'Frozen moon.' }

function fakeLookup(results: LookupResult[], details: Partial<Record<FieldKey, string>> = starfallDetails) {
  const calls: string[] = []
  const l: Lookup = {
    async search(type, q) { calls.push(`search:${type}:${q}`); return results },
    async details(type, id) { calls.push(`details:${type}:${id}`); return details },
  }
  return { l, calls }
}
const r = (name: string, year: number | undefined, id = 'tt1000419'): LookupResult => ({ source: 'omdb', id, name, year, detail: '' })

describe('Enricher.runOnce', () => {
  it('fills all fields from a clear match in one setFields call', async () => {
    const store = new FakeStore([title({ year: 2021 })])
    const { l, calls } = fakeLookup([r('Starfall', 2021), r('Starfall', 1984, 'tt0000182')])
    expect(await new Enricher(store, l).runOnce()).toEqual({ filled: 1, unsure: 0 })
    const { year: _year, ...rest } = starfallDetails // year is already on the title
    expect(store.writes).toEqual([{ pageId: 'p1', fields: rest }])
    expect(calls).toEqual(['search:movie:Starfall', 'details:movie:tt1000419'])
  })

  it('treats a year within 1 and punctuation/case/diacritic differences as a match', async () => {
    const store = new FakeStore([title({ name: 'Amélie & Co', year: 2001 })])
    const { l } = fakeLookup([r('amelie and co.', 2002)])
    await new Enricher(store, l).runOnce()
    expect(store.writes).toHaveLength(1)
  })

  it('writes nothing and counts unsure when two results match a title with no year', async () => {
    const store = new FakeStore([title({ name: 'The Visitor' })])
    const { l, calls } = fakeLookup([r('The Visitor', 1982, 'a'), r('The Visitor', 2011, 'b')])
    expect(await new Enricher(store, l).runOnce()).toEqual({ filled: 0, unsure: 1 })
    expect(store.writes).toEqual([])
    expect(calls).toEqual(['search:movie:The Visitor'])
  })

  it('does not re-search an unsure title unless its updatedAt changed', async () => {
    const t = title({ name: 'The Visitor' })
    const store = new FakeStore([t])
    const { l, calls } = fakeLookup([r('The Visitor', 1982, 'a'), r('The Visitor', 2011, 'b')])
    const e = new Enricher(store, l)
    await e.runOnce()
    expect(await e.runOnce()).toEqual({ filled: 0, unsure: 0 })
    expect(calls).toHaveLength(1)
    t.updatedAt = 2000
    expect((await e.runOnce()).unsure).toBe(1)
    expect(calls).toHaveLength(2)
  })

  it('is unsure when the only result is the wrong year', async () => {
    const store = new FakeStore([title({ year: 2021 })])
    const { l } = fakeLookup([r('Starfall', 1984)])
    expect((await new Enricher(store, l).runOnce()).unsure).toBe(1)
  })

  it('with imdb but missing summary: details only, writes only missing fields', async () => {
    const store = new FakeStore([title({ imdb: 'tt1000419', year: 2021, runtime: 155, genre: ['Drama'], rt: 70 })])
    const { l, calls } = fakeLookup([])
    await new Enricher(store, l).runOnce()
    expect(calls).toEqual(['details:movie:tt1000419'])
    expect(store.writes[0]!.fields).toEqual({ summary: 'Frozen moon.' })
  })

  it('never overwrites existing values', async () => {
    const store = new FakeStore([title({ imdb: 'tt1000419', year: 1999, genre: ['Mine'] })])
    const { l } = fakeLookup([])
    await new Enricher(store, l).runOnce()
    expect(store.writes[0]!.fields).toEqual({ runtime: '155', rt: '83', summary: 'Frozen moon.' })
  })

  it('makes no calls for a complete title, and a missing rt alone is not a reason to look', async () => {
    const store = new FakeStore([title({ imdb: 'tt1', year: 2021, runtime: 155, genre: ['Drama'], summary: 's', director: ['D'], writer: ['W'], cast: ['C'], poster: 'https://p' })])
    const { l, calls } = fakeLookup([])
    expect(await new Enricher(store, l).runOnce()).toEqual({ filled: 0, unsure: 0 })
    expect(calls).toEqual([])
  })

  it('skips games', async () => {
    const store = new FakeStore([title({ type: 'game' })])
    const { l, calls } = fakeLookup([])
    await new Enricher(store, l).runOnce()
    expect(calls).toEqual([])
  })

  it('retries after a transient error and does not throw', async () => {
    const store = new FakeStore([title({})])
    let fail = true
    const l: Lookup = {
      async search() { if (fail) throw new LookupUnavailableError('down'); return [r('Starfall', undefined)] },
      async details() { return starfallDetails },
    }
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    const e = new Enricher(store, l)
    expect(await e.runOnce()).toEqual({ filled: 0, unsure: 0 })
    expect(err).toHaveBeenCalled()
    fail = false
    expect((await e.runOnce()).filled).toBe(1)
    err.mockRestore()
  })

  it('memoizes a completed attempt that had nothing new', async () => {
    const store = new FakeStore([title({ imdb: 'tt1', year: 2021 })])
    const { l, calls } = fakeLookup([], { imdb: 'tt1', year: '2021' })
    const e = new Enricher(store, l)
    await e.runOnce()
    await e.runOnce()
    expect(calls).toHaveLength(1)
  })

  it('OMDb limit: nothing written and later runs make zero fetches the same day', async () => {
    const store = new FakeStore([title({}), title({ pageId: 'p2', name: 'Comet' })])
    const calls: string[] = []
    const fetch = async (url: string) => { calls.push(url); return new Response(JSON.stringify({ Response: 'False', Error: 'Request limit reached!' }), { status: 401 }) }
    const omdb = new OmdbClient({ apiKey: 'k', fetch, now: () => Date.parse('2026-10-19T12:00:00Z') })
    const e = new Enricher(store, new RoutingLookup(omdb))
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    await e.runOnce()
    await e.runOnce()
    err.mockRestore()
    expect(store.writes).toEqual([])
    expect(calls).toHaveLength(1)
  })

  it('a show with no Rotten Tomatoes rating gets no rt', async () => {
    const store = new FakeStore([title({ name: 'Overtime', type: 'show' })])
    const body = (b: unknown) => new Response(JSON.stringify(b))
    const fetch = async (url: string) => url.includes('s=')
      ? body({ Search: [{ Title: 'Overtime', Year: '2022–', imdbID: 'tt11000740', Type: 'series', Poster: 'N/A' }], totalResults: '1', Response: 'True' })
      : body({ Title: 'Overtime', Year: '2022–', Runtime: '55 min', Genre: 'Drama', Plot: 'Office.', Ratings: [{ Source: 'Internet Movie Database', Value: '8.7/10' }], imdbID: 'tt11000740', Type: 'series', Response: 'True' })
    const e = new Enricher(store, new RoutingLookup(new OmdbClient({ apiKey: 'k', fetch })))
    await e.runOnce()
    expect(store.writes[0]!.fields).toEqual({ imdb: 'tt11000740', year: '2022', runtime: '55', genre: 'Drama', summary: 'Office.' })
  })
})

describe('Enricher edge cases', () => {
  it('missing OMDb key: one summary log line per run, not one per title', async () => {
    const store = new FakeStore([1, 2, 3].map((n) => title({ pageId: `p${n}`, name: `Film ${n}` })))
    const fetch = async () => { throw new Error('should not fetch') }
    const e = new Enricher(store, new RoutingLookup(new OmdbClient({ fetch })))
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    await e.runOnce()
    expect(err).toHaveBeenCalledTimes(1)
    expect(String(err.mock.calls[0]![0])).toContain('skipped 3')
    err.mockRestore()
  })

  it('retries when details throws once after a clear match', async () => {
    const store = new FakeStore([title({})])
    let fail = true
    const l: Lookup = {
      async search() { return [r('Starfall', undefined)] },
      async details() { if (fail) throw new LookupUnavailableError('blip'); return starfallDetails },
    }
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    const e = new Enricher(store, l)
    await e.runOnce()
    expect(store.writes).toEqual([])
    fail = false
    expect((await e.runOnce()).filled).toBe(1)
    err.mockRestore()
  })

  it('matches hyphenated and non-Latin names, never an empty one', async () => {
    const a = new FakeStore([title({ name: 'Ant-Hill' })])
    await new Enricher(a, fakeLookup([r('Ant Hill', undefined)]).l).runOnce()
    expect(a.writes).toHaveLength(1)
    const b = new FakeStore([title({ name: '星の図書館' })])
    await new Enricher(b, fakeLookup([r('星の図書館', undefined)]).l).runOnce()
    expect(b.writes).toHaveLength(1)
    const c = new FakeStore([title({ name: '!!!' })])
    expect((await new Enricher(c, fakeLookup([r('???', undefined)]).l).runOnce()).unsure).toBe(1)
    expect(c.writes).toEqual([])
  })

  it('drops fields that were filled after the snapshot, and writes nothing if the page is gone', async () => {
    const t = title({})
    const store = new FakeStore([t])
    const l: Lookup = {
      async search() { return [r('Starfall', undefined)] },
      async details() { t.summary = 'User wrote this'; t.runtime = 100; return starfallDetails },
    }
    // listTitles hands out a stale copy
    store.listTitles = async () => [{ ...t }]
    await new Enricher(store, l).runOnce()
    expect(store.writes[0]!.fields).not.toHaveProperty('summary')
    expect(store.writes[0]!.fields).not.toHaveProperty('runtime')
    expect(store.writes[0]!.fields).toHaveProperty('genre')

    const gone = new FakeStore([title({})])
    gone.getTitle = async () => null
    await new Enricher(gone, fakeLookup([r('Starfall', undefined)]).l).runOnce()
    expect(gone.writes).toEqual([])
  })
})

describe('Enricher.enrichNow', () => {
  it('ignores the memo and no-ops for a missing page', async () => {
    const store = new FakeStore([title({ name: 'The Visitor' })])
    const { l, calls } = fakeLookup([r('The Visitor', 1982, 'a'), r('The Visitor', 2011, 'b')])
    const e = new Enricher(store, l)
    await e.runOnce()
    await e.enrichNow('p1')
    expect(calls).toHaveLength(2)
    await e.enrichNow('nope')
    expect(calls).toHaveLength(2)
  })
})

describe('Enricher.start', () => {
  it('runs immediately, then on the interval without overlapping', async () => {
    vi.useFakeTimers()
    try {
      const store = new FakeStore([title({})])
      let release!: () => void
      const gate = new Promise<void>((res) => { release = res })
      let searches = 0
      const l: Lookup = { async search() { searches++; await gate; return [] }, async details() { return {} } }
      const e = new Enricher(store, l)
      e.start(1000)
      await vi.advanceTimersByTimeAsync(3500)
      expect(searches).toBe(1)
      release()
      await vi.advanceTimersByTimeAsync(1000)
      e.stop()
      expect(searches).toBe(1) // unsure title is memoized, so later runs make no search
    } finally {
      vi.useRealTimers()
    }
  })
})
