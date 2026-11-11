import { describe, expect, it } from 'vitest'
import { OmdbClient, people, createOmdbClient } from './omdb.ts'
import { getJson, LookupUnavailableError } from './lookupError.ts'

const starfall = {
  Title: 'Starfall', Year: '2021', Rated: 'PG-13', Released: '22 Oct 2021', Runtime: '155 min',
  Genre: 'Action, Adventure, Drama', Director: 'Ada Lindqvist', Writer: 'Tom Reyes', Actors: 'Renée Okafor',
  Plot: 'A mining crew finds a fallen star on a frozen moon.', Language: 'English',
  Country: 'United States', Awards: 'Won 6 Oscars', Poster: 'N/A',
  Ratings: [
    { Source: 'Internet Movie Database', Value: '8.0/10' },
    { Source: 'Rotten Tomatoes', Value: '83%' },
    { Source: 'Metacritic', Value: '74/100' },
  ],
  Metascore: '74', imdbRating: '8.0', imdbVotes: '700,000', imdbID: 'tt1000419', Type: 'movie',
  DVD: 'N/A', BoxOffice: '$108,000,000', Production: 'N/A', Website: 'N/A', Response: 'True',
}
const limit = { Response: 'False', Error: 'Request limit reached!' }

function fakeFetch(respond: (url: string) => { status?: number; body: unknown }) {
  const calls: string[] = []
  const fetch = async (url: string) => {
    calls.push(url)
    const { status = 200, body } = respond(url)
    return new Response(JSON.stringify(body), { status })
  }
  return { fetch, calls }
}

describe('OmdbClient.details', () => {
  it('maps a movie', async () => {
    const f = fakeFetch(() => ({ body: starfall }))
    const c = new OmdbClient({ apiKey: 'k', fetch: f.fetch })
    expect(await c.details('movie', 'tt1000419')).toEqual({
      imdb: 'tt1000419', year: '2021', runtime: '155', genre: 'Action, Adventure, Drama',
      rt: '83', summary: starfall.Plot, director: 'Ada Lindqvist', writer: 'Tom Reyes', cast: 'Renée Okafor',
    })
    expect(f.calls[0]).toContain('i=tt1000419')
    expect(f.calls[0]).toContain('plot=short')
    expect(f.calls[0]).toContain('apikey=k')
  })

  it('takes the first year of a running series and omits rt when there is no Rotten Tomatoes rating', async () => {
    const show = { ...starfall, Type: 'series', Year: '2011–2019', Runtime: '57 min', Ratings: [{ Source: 'Internet Movie Database', Value: '9.2/10' }] }
    const c = new OmdbClient({ apiKey: 'k', fetch: fakeFetch(() => ({ body: show })).fetch })
    const d = await c.details('show', 'tt0900947')
    expect(d.year).toBe('2011')
    expect(d).not.toHaveProperty('rt')
  })

  it('drops an implausible series runtime (OMDb lists some series as "1 min") but keeps a real one', async () => {
    const junk = { ...starfall, Type: 'series', Runtime: '1 min' }
    const c1 = new OmdbClient({ apiKey: 'k', fetch: fakeFetch(() => ({ body: junk })).fetch })
    expect(await c1.details('show', 'tt1')).not.toHaveProperty('runtime')
    const real = { ...starfall, Type: 'series', Runtime: '24 min' }
    const c2 = new OmdbClient({ apiKey: 'k', fetch: fakeFetch(() => ({ body: real })).fetch })
    expect((await c2.details('show', 'tt1')).runtime).toBe('24')
  })

  it('handles an open-ended series year', async () => {
    const show = { ...starfall, Year: '2022–' }
    const c = new OmdbClient({ apiKey: 'k', fetch: fakeFetch(() => ({ body: show })).fetch })
    expect((await c.details('show', 'tt1')).year).toBe('2022')
  })

  it('omits N/A fields', async () => {
    const sparse = { ...starfall, Runtime: 'N/A', Genre: 'N/A', Plot: 'N/A', Year: 'N/A', Ratings: [], Director: 'N/A', Writer: 'N/A', Actors: 'N/A', Poster: 'N/A' }
    const c = new OmdbClient({ apiKey: 'k', fetch: fakeFetch(() => ({ body: sparse })).fetch })
    expect(await c.details('movie', 'tt1000419')).toEqual({ imdb: 'tt1000419' })
  })
})

describe('people', () => {
  it('keeps names only, once each, up to the limit', () => {
    expect(people('June Halloway, Ines Moreau (original story), June Halloway (screenplay), A, B', 3)).toBe('June Halloway, Ines Moreau, A')
    expect(people('N/A', 3)).toBeUndefined()
  })
})

describe('OmdbClient.search', () => {
  it('maps results and sends type=series for shows', async () => {
    const f = fakeFetch(() => ({
      body: { Search: [{ Title: 'Starfall', Year: '2021', imdbID: 'tt1000419', Type: 'movie', Poster: 'N/A' }, { Title: 'Starfall', Year: '1984', imdbID: 'tt0000182', Type: 'movie', Poster: 'N/A' }], totalResults: '2', Response: 'True' },
    }))
    const c = new OmdbClient({ apiKey: 'k', fetch: f.fetch })
    const r = await c.search('movie', 'Starfall & more')
    expect(r).toEqual([
      { source: 'omdb', id: 'tt1000419', name: 'Starfall', year: 2021, detail: 'Movie · 2021' },
      { source: 'omdb', id: 'tt0000182', name: 'Starfall', year: 1984, detail: 'Movie · 1984' },
    ])
    expect(f.calls[0]).toContain('s=Starfall%20%26%20more')
    expect(f.calls[0]).toContain('type=movie')
    await c.search('show', 'x')
    expect(f.calls[1]).toContain('type=series')
  })

  it('returns [] when nothing is found', async () => {
    const c = new OmdbClient({ apiKey: 'k', fetch: fakeFetch(() => ({ body: { Response: 'False', Error: 'Movie not found!' } })).fetch })
    expect(await c.search('movie', 'zzzz')).toEqual([])
    const c2 = new OmdbClient({ apiKey: 'k', fetch: fakeFetch(() => ({ body: { Response: 'False', Error: 'Too many results.' } })).fetch })
    expect(await c2.search('movie', 'a')).toEqual([])
  })
})

describe('OmdbClient failures', () => {
  it('pauses after the limit until the next UTC day', async () => {
    let t = Date.parse('2026-10-19T23:59:00Z')
    const f = fakeFetch(() => ({ status: 401, body: limit }))
    const c = new OmdbClient({ apiKey: 'k', fetch: f.fetch, now: () => t })
    await expect(c.search('movie', 'x')).rejects.toBeInstanceOf(LookupUnavailableError)
    expect(f.calls).toHaveLength(1)
    await expect(c.details('movie', 'tt1')).rejects.toBeInstanceOf(LookupUnavailableError)
    await expect(c.search('movie', 'x')).rejects.toBeInstanceOf(LookupUnavailableError)
    expect(f.calls).toHaveLength(1)
    t = Date.parse('2026-10-20T00:00:01Z')
    await expect(c.search('movie', 'x')).rejects.toBeInstanceOf(LookupUnavailableError)
    expect(f.calls).toHaveLength(2)
  })

  it('throws unavailable on a network error', async () => {
    const c = new OmdbClient({ apiKey: 'k', fetch: async () => { throw new TypeError('fetch failed') } })
    await expect(c.search('movie', 'x')).rejects.toBeInstanceOf(LookupUnavailableError)
  })

  it('throws unavailable on a non-OK response', async () => {
    const c = new OmdbClient({ apiKey: 'k', fetch: fakeFetch(() => ({ status: 503, body: { nope: true } })).fetch })
    await expect(c.details('movie', 'tt1')).rejects.toBeInstanceOf(LookupUnavailableError)
  })

  it('throws without fetching when the key is missing', async () => {
    const f = fakeFetch(() => ({ body: starfall }))
    const c = new OmdbClient({ fetch: f.fetch })
    await expect(c.search('movie', 'x')).rejects.toBeInstanceOf(LookupUnavailableError)
    await expect(c.details('movie', 'tt1')).rejects.toBeInstanceOf(LookupUnavailableError)
    expect(f.calls).toHaveLength(0)
  })

  it('factory reads OMDB_API_KEY', async () => {
    const prev = process.env.OMDB_API_KEY
    delete process.env.OMDB_API_KEY
    try {
      const f = fakeFetch(() => ({ body: starfall }))
      await expect(createOmdbClient({ fetch: f.fetch }).search('movie', 'x')).rejects.toBeInstanceOf(LookupUnavailableError)
      expect(f.calls).toHaveLength(0)
      process.env.OMDB_API_KEY = 'envkey'
      await createOmdbClient({ fetch: f.fetch }).details('movie', 'tt1')
      expect(f.calls[0]).toContain('apikey=envkey')
    } finally {
      if (prev === undefined) delete process.env.OMDB_API_KEY
      else process.env.OMDB_API_KEY = prev
    }
  })
})

describe('getJson timeout', () => {
  it('maps a request that never answers to LookupUnavailableError', async () => {
    const never = () => new Promise<Response>(() => {})
    await expect(getJson(never, 'http://x', 'OMDb', 20)).rejects.toThrow(/OMDb unreachable: timed out/)
    await expect(getJson(never, 'http://x', 'OMDb', 20)).rejects.toBeInstanceOf(LookupUnavailableError)
  })
})
