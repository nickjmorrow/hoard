import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Jellyfin, createJellyfin } from './jellyfin.ts'

const fx = (n: string) => readFileSync(join(import.meta.dirname, 'fixtures', n), 'utf8')
type F = typeof globalThis.fetch

function server(handler?: (url: string) => Response | Promise<Response>, timeoutMs?: number) {
  const fetch = vi.fn(async (url: string | URL | Request, _init?: RequestInit) => {
    const u = String(url)
    if (handler) return handler(u)
    return new Response(u.includes('/Items') ? fx('jellyfin-items.json') : fx('jellyfin-users.json'))
  })
  return { fetch, j: new Jellyfin({ url: 'http://jf:8096', apiKey: 'secret', fetch: fetch as unknown as F, timeoutMs }) }
}

describe('Jellyfin', () => {
  beforeEach(() => { vi.spyOn(console, 'error').mockImplementation(() => {}) })
  afterEach(() => { vi.restoreAllMocks() })

  it('is unknown before the first refresh', () => {
    const { j } = server()
    expect(j.onEdgar('tt27000598')).toBeNull()
    expect(j.isUp()).toBe(false)
    expect(j.items()).toEqual([])
  })

  it('calls the right URLs with the MediaBrowser token header', async () => {
    const { j, fetch } = server()
    expect(await j.refresh()).toBe(true)
    const urls = fetch.mock.calls.map((c) => String(c[0]))
    expect(urls[0]).toBe('http://jf:8096/Users')
    expect(urls[1]).toBe('http://jf:8096/Users/00000000000000000000000000000005/Items?IncludeItemTypes=Movie,Series&Recursive=true&Fields=ProviderIds,UserData')
    for (const c of fetch.mock.calls) {
      expect((c[1]?.headers as Record<string, string>).Authorization).toBe('MediaBrowser Token="secret"')
    }
  })

  it('maps items, ignoring those without an IMDb id', async () => {
    const { j } = server()
    await j.refresh()
    const items = j.items()
    expect(items.map((i) => i.imdb).sort()).toEqual(['tt1900272', 'tt2000171', 'tt27000598', 'tt34000231'])
    expect(items.find((i) => i.imdb === 'tt27000598')).toMatchObject({ imdb: 'tt27000598', played: true, lastPlayed: '2026-10-08T02:21:23.813365Z' })
    expect(items.find((i) => i.imdb === 'tt2000171')?.played).toBe(false)
    expect(items.find((i) => i.imdb === 'tt34000231')).toMatchObject({ imdb: 'tt34000231', played: false })
  })

  it('reports availability while up', async () => {
    const { j } = server()
    await j.refresh()
    expect(j.isUp()).toBe(true)
    expect(j.onEdgar('tt27000598')).toBe(true)
    expect(j.onEdgar('TT27000598')).toBe(true)
    expect(j.onEdgar('tt0000001')).toBe(false)
  })

  it('prefers a played duplicate, then the latest last-played', async () => {
    const mk = (imdb: string, played: boolean, last?: string) => ({ ProviderIds: { Imdb: imdb }, UserData: { Played: played, LastPlayedDate: last } })
    const { j } = server((u) => new Response(JSON.stringify(u.includes('/Items')
      ? { Items: [mk('tt1', false, '2026-10-09T00:00:00Z'), mk('tt1', true, '2026-10-01T00:00:00Z'), mk('tt1', true, '2026-10-05T00:00:00Z'), mk('tt1', false)] }
      : [{ Id: 'u' }])))
    await j.refresh()
    expect(j.items()).toEqual([{ imdb: 'tt1', played: true, lastPlayed: '2026-10-05T00:00:00Z' }])
  })

  it('goes down on failures and recovers on the next good refresh', async () => {
    let mode: 'ok' | 'reject' | '500' | 'json' | 'nousers' = 'ok'
    const { j } = server((u) => {
      if (mode === 'reject') throw new Error('ECONNREFUSED')
      if (mode === '500') return new Response('no', { status: 500 })
      if (mode === 'json') return new Response('<html>')
      if (mode === 'nousers' && !u.includes('/Items')) return new Response('[]')
      return new Response(u.includes('/Items') ? fx('jellyfin-items.json') : fx('jellyfin-users.json'))
    })
    expect(await j.refresh()).toBe(true)
    for (const m of ['reject', '500', 'json'] as const) {
      mode = m
      expect(await j.refresh()).toBe(false)
      expect(j.isUp()).toBe(false)
      expect(j.onEdgar('tt27000598')).toBeNull()
      expect(j.items()).toEqual([])
    }
    mode = 'ok'
    expect(await j.refresh()).toBe(true)
    expect(j.onEdgar('tt27000598')).toBe(true)
  })

  it('times out a Jellyfin that never answers', async () => {
    const fetch = (_u: string | URL | Request, init?: RequestInit) => new Promise<Response>((_, reject) => {
      init?.signal?.addEventListener('abort', () => reject(init.signal?.reason))
    })
    const j = new Jellyfin({ url: 'http://jf', apiKey: 'k', fetch: fetch as unknown as F, timeoutMs: 20 })
    expect(await j.refresh()).toBe(false)
    expect(j.onEdgar('tt1')).toBeNull()
  })

  it('logs only on the transition to down, and once on recovery', async () => {
    let ok = false
    const { j } = server((u) => {
      if (!ok) return new Response('no', { status: 500 })
      return new Response(u.includes('/Items') ? fx('jellyfin-items.json') : fx('jellyfin-users.json'))
    })
    const spy = vi.mocked(console.error)
    await j.refresh()
    await j.refresh()
    expect(spy).toHaveBeenCalledTimes(1)
    ok = true
    await j.refresh()
    await j.refresh()
    expect(spy).toHaveBeenCalledTimes(2)
  })

  it('treats an empty user list as down', async () => {
    const { j } = server((u) => new Response(u.includes('/Items') ? fx('jellyfin-items.json') : '[]'))
    expect(await j.refresh()).toBe(false)
    expect(j.onEdgar('tt27000598')).toBeNull()
  })

  it('caches the user id across refreshes', async () => {
    const { j, fetch } = server()
    await j.refresh()
    await j.refresh()
    expect(fetch.mock.calls.filter((c) => String(c[0]).endsWith('/Users'))).toHaveLength(1)
    expect(fetch).toHaveBeenCalledTimes(3)
  })
})

describe('Jellyfin played series', () => {
  beforeEach(() => { vi.spyOn(console, 'error').mockImplementation(() => {}) })
  afterEach(() => { vi.restoreAllMocks() })

  const ORBIT = '00000000000000000000000000000003'
  const episodes = JSON.parse(fx('jellyfin-played-episodes.json')) as { Items: { SeriesId: string; UserData: { LastPlayedDate: string } }[] }
  const maxEpisode = episodes.Items.filter((e) => e.SeriesId === ORBIT).map((e) => e.UserData.LastPlayedDate)
    .reduce((a, b) => (Date.parse(b) > Date.parse(a) ? b : a))
  const itemsWith = (played: boolean) => {
    const body = JSON.parse(fx('jellyfin-items.json')) as { Items: { Id: string; UserData: Record<string, unknown> }[] }
    for (const i of body.Items) if (i.Id === ORBIT) i.UserData.Played = played
    return JSON.stringify(body)
  }
  const play = (played: boolean) => server((u) => {
    if (u.includes('IncludeItemTypes=Episode')) return new Response(fx('jellyfin-played-episodes.json'))
    return new Response(u.includes('/Items') ? itemsWith(played) : fx('jellyfin-users.json'))
  })

  it('takes a played series\' lastPlayed from its latest played episode', async () => {
    const { j, fetch } = play(true)
    expect(await j.refresh()).toBe(true)
    expect(maxEpisode).toBe('2026-10-06T01:21:22.447607Z')
    expect(j.items().find((i) => i.imdb === 'tt34000231')).toMatchObject({ imdb: 'tt34000231', played: true, lastPlayed: maxEpisode })
    const urls = fetch.mock.calls.map((c) => String(c[0]))
    expect(urls[2]).toBe('http://jf:8096/Users/00000000000000000000000000000005/Items?IncludeItemTypes=Episode&IsPlayed=true&Recursive=true&Fields=UserData')
    expect((fetch.mock.calls[2]?.[1]?.headers as Record<string, string>).Authorization).toBe('MediaBrowser Token="secret"')
  })

  it('skips the episodes call when no played series lacks a date', async () => {
    const { j, fetch } = play(false)
    await j.refresh()
    expect(fetch.mock.calls.map((c) => String(c[0])).some((u) => u.includes('Episode'))).toBe(false)
    expect(j.items().find((i) => i.imdb === 'tt34000231')).toMatchObject({ imdb: 'tt34000231', played: false })
  })

  it('goes down when the episodes call fails', async () => {
    const { j } = server((u) => {
      if (u.includes('IncludeItemTypes=Episode')) return new Response('no', { status: 500 })
      return new Response(u.includes('/Items') ? itemsWith(true) : fx('jellyfin-users.json'))
    })
    expect(await j.refresh()).toBe(false)
    expect(j.isUp()).toBe(false)
  })
})

describe('createJellyfin', () => {
  afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals() })

  it('reports down without fetching when env is missing', async () => {
    vi.stubEnv('JELLYFIN_URL', '')
    vi.stubEnv('JELLYFIN_API_KEY', '')
    const f = vi.fn()
    vi.stubGlobal('fetch', f)
    const j = createJellyfin()
    expect(await j.refresh()).toBe(false)
    expect(j.isUp()).toBe(false)
    expect(j.onEdgar('tt1')).toBeNull()
    expect(f).not.toHaveBeenCalled()
  })

  it('reads JELLYFIN_URL and JELLYFIN_API_KEY', async () => {
    vi.stubEnv('JELLYFIN_URL', 'http://x/')
    vi.stubEnv('JELLYFIN_API_KEY', 'abc')
    const f = vi.fn(async (url: string | URL | Request, _i?: RequestInit) =>
      new Response(String(url).includes('/Items') ? fx('jellyfin-items.json') : fx('jellyfin-users.json')))
    vi.stubGlobal('fetch', f)
    const j = createJellyfin()
    expect(await j.refresh()).toBe(true)
    expect(String(f.mock.calls[0]?.[0])).toBe('http://x/Users')
    expect((f.mock.calls[0]?.[1]?.headers as Record<string, string>).Authorization).toBe('MediaBrowser Token="abc"')
  })
})

describe('Jellyfin item names', () => {
  it('carries each item\'s name, year and kind for ID matching', async () => {
    const fetch = vi.fn(async (url: string | URL | Request) => new Response(readFileSync(join(import.meta.dirname, 'fixtures', String(url).includes('/Items') ? 'jellyfin-items.json' : 'jellyfin-users.json'), 'utf8')))
    const j = new Jellyfin({ url: 'http://jf', apiKey: 'k', fetch: fetch as unknown as typeof globalThis.fetch })
    await j.refresh()
    expect(j.items().find((i) => i.imdb === 'tt2000171')).toMatchObject({ name: '7 Doors', year: 2014, kind: 'movie' })
  })
})

describe('Jellyfin item IDs', () => {
  it('exposes the Jellyfin item id for an IMDb id, and null when it is not on the server or Jellyfin is down', async () => {
    const fetch = vi.fn(async (url: string | URL | Request) => new Response(readFileSync(join(import.meta.dirname, 'fixtures', String(url).includes('/Items') ? 'jellyfin-items.json' : 'jellyfin-users.json'), 'utf8')))
    const j = new Jellyfin({ url: 'http://jf', apiKey: 'k', fetch: fetch as unknown as typeof globalThis.fetch })
    expect(j.jellyfinId('tt2000171')).toBeNull() // before the first refresh: unknown
    await j.refresh()
    const id = j.jellyfinId('TT2000171')
    expect(id).toMatch(/^[0-9a-f]{32}$/)
    expect(j.jellyfinId('tt0000000')).toBeNull()
    const down = new Jellyfin({ url: 'http://jf', apiKey: 'k', fetch: (async () => { throw new Error('down') }) as unknown as typeof globalThis.fetch })
    await down.refresh()
    expect(down.jellyfinId('tt2000171')).toBeNull()
  })
})
