import { describe, expect, it } from 'vitest'
import { Library } from './library.ts'
import { LookupUnavailableError } from './lookupError.ts'
import { MdblistClient, RtFiller, tomatometer, WithRt, type RtSource } from './mdblist.ts'
import type { Lookup } from './ports.ts'
import { Store } from './store.ts'

describe('tomatometer', () => {
  it('reads the critics score, not the audience one', () => {
    expect(tomatometer({ ratings: [{ source: 'imdb', value: 7.1 }, { source: 'popcorn', value: 63 }, { source: 'tomatoes', value: 83, score: 83 }] })).toBe(83)
    expect(tomatometer({ ratings: [{ source: 'tomatoes', value: null, score: null }] })).toBeUndefined()
    expect(tomatometer({})).toBeUndefined()
  })
})

describe('MdblistClient', () => {
  it('asks by IMDb id and pauses for the day on 429', async () => {
    const urls: string[] = []
    let status = 200
    const client = new MdblistClient({
      apiKey: 'k',
      fetch: async (url) => { urls.push(url); return new Response(JSON.stringify({ ratings: [{ source: 'tomatoes', value: 91 }] }), { status }) },
    })
    expect(await client.rt('show', 'tt1')).toBe(91)
    expect(urls[0]).toBe('https://api.mdblist.com/imdb/show/tt1?apikey=k')
    status = 429
    await expect(client.rt('movie', 'tt2')).rejects.toBeInstanceOf(LookupUnavailableError)
    await expect(client.rt('movie', 'tt3')).rejects.toBeInstanceOf(LookupUnavailableError)
    expect(urls).toHaveLength(2)
  })
})

describe('WithRt', () => {
  const omdb = (rt?: string): Lookup => ({ search: async () => [], details: async (_t, id) => ({ imdb: id, ...(rt ? { rt } : {}) }) })
  it('adds MDBList RT only when OMDb has none, and shrugs off MDBList being out', async () => {
    const source: RtSource = { rt: async () => 77 }
    expect(await new WithRt(omdb(), source).details('movie', 'tt1')).toEqual({ imdb: 'tt1', rt: '77' })
    expect(await new WithRt(omdb('90'), source).details('movie', 'tt1')).toEqual({ imdb: 'tt1', rt: '90' })
    const out: RtSource = { rt: async () => { throw new LookupUnavailableError('limit') } }
    expect(await new WithRt(omdb(), out).details('movie', 'tt1')).toEqual({ imdb: 'tt1' })
  })
})

describe('RtFiller', () => {
  it('fills RT on suggestions and library titles, and leaves ones with no score alone for a while', async () => {
    const store = new Store(':memory:')
    const library = new Library(store)
    const [s] = store.addSuggestions([{ name: 'Far Field', type: 'movie', imdb: 'tt1', why: 'x', source: 'For you', fields: { imdb: 'tt1' } }])
    const t = await library.createTitle({ name: 'Near Field', type: 'movie', fields: { imdb: 'tt2' }, tags: [] })
    await library.createTitle({ name: 'No Score', type: 'movie', fields: { imdb: 'tt3' }, tags: [] })
    const asked: string[] = []
    const scores: Record<string, number> = { tt1: 88, tt2: 64 }
    const filler = new RtFiller(library, store, { rt: async (_type, id) => { asked.push(id); return scores[id] } })

    expect(await filler.runOnce()).toBe(2)
    expect(store.suggestion(s!.id)?.fields.rt).toBe('88')
    expect((await library.getTitle(t.pageId))?.rt).toBe(64)
    asked.length = 0
    expect(await filler.runOnce()).toBe(0)
    expect(asked).toEqual([])
  })
})
