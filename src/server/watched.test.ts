import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { FieldKey, Title } from '../shared/title.ts'
import { Jellyfin } from './jellyfin.ts'
import type { JellyfinItem } from './jellyfin.ts'
import type { SetFieldsOptions, TitleStore } from './titleStore.ts'
import { decideWatched, runWatchedOnce, startWatchedLoop } from './watched.ts'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

function title(over: Partial<Title> = {}): Title {
  return {
    pageId: 'p1', pageTitle: 'Ashvale (2024)', name: 'Ashvale', type: 'movie', status: 'want', tags: [],
    imdb: 'tt27000598', notesText: '', updatedAt: Date.parse('2026-10-01T00:00:00Z'), createdAt: 1, ...over,
  }
}
const played: JellyfinItem = { imdb: 'tt27000598', played: true, lastPlayed: '2026-10-08T02:21:23.813365Z' }

describe('decideWatched', () => {
  it('marks done with the local date when played after the last edit', () => {
    expect(decideWatched(title(), played)).toEqual({ status: 'done', finished: '2026-10-07' })
    expect(decideWatched(title({ status: 'doing' }), played)).toEqual({ status: 'done', finished: '2026-10-07' })
  })
  it('uses the local calendar day, not the UTC day', () => {
    const t = title({ updatedAt: 0 })
    expect(decideWatched(t, { ...played, lastPlayed: '2026-10-08T03:59:59Z' })?.finished).toBe('2026-10-07')
    expect(decideWatched(t, { ...played, lastPlayed: '2026-10-08T04:00:01Z' })?.finished).toBe('2026-10-08')
    // Winter (EST, UTC-5)
    expect(decideWatched(t, { ...played, lastPlayed: '2026-01-15T04:30:00Z' })?.finished).toBe('2026-01-14')
  })
  it('does nothing when played before the last edit', () => {
    expect(decideWatched(title({ updatedAt: Date.parse('2026-10-09T00:00:00Z') }), played)).toBeNull()
  })
  it('never touches dropped or done titles', () => {
    expect(decideWatched(title({ status: 'dropped' }), played)).toBeNull()
    expect(decideWatched(title({ status: 'done' }), played)).toBeNull()
  })
  it('does nothing without a last-played time or with an unparseable one', () => {
    expect(decideWatched(title(), { imdb: 'tt27000598', played: true })).toBeNull()
    expect(decideWatched(title(), { ...played, lastPlayed: 'not a date' })).toBeNull()
  })
  it('does nothing for a partly watched item', () => {
    expect(decideWatched(title({ type: 'show' }), { imdb: 'tt34000231', played: false })).toBeNull()
    expect(decideWatched(title(), { ...played, played: false })).toBeNull()
  })
  it('parses 5 to 7 fractional-second digits', () => {
    const t = title({ updatedAt: Date.parse('2026-10-08T02:21:23.000Z') })
    for (const f of ['41569', '413365', '4133650']) {
      expect(decideWatched(t, { ...played, lastPlayed: `2026-10-08T02:21:23.${f}Z` })).not.toBeNull()
    }
    expect(decideWatched(title({ updatedAt: Date.parse('2026-10-08T02:21:24Z') }), played)).toBeNull()
  })
})

const fx = (n: string) => readFileSync(join(import.meta.dirname, 'fixtures', n), 'utf8')

function fakeJellyfin(up = true) {
  const fetch = vi.fn(async (url: string | URL | Request) => {
    if (!up) throw new Error('down')
    const u = String(url)
    return new Response(u.includes('/Items') ? fx('jellyfin-items.json') : fx('jellyfin-users.json'))
  })
  return new Jellyfin({ url: 'http://jf', apiKey: 'k', fetch: fetch as unknown as typeof globalThis.fetch })
}

class FakeStore implements TitleStore {
  writes: { pageId: string; fields: Partial<Record<FieldKey, string | null>> }[] = []
  optsSeen: (SetFieldsOptions | undefined)[] = []
  listCalls = 0
  failOn = new Set<string>()
  titles: Title[]
  constructor(titles: Title[]) { this.titles = titles }
  async listTitles() { this.listCalls++; return this.titles }
  async getTitle(id: string) { return this.titles.find((t) => t.pageId === id) ?? null }
  async setFields(pageId: string, fields: Partial<Record<FieldKey, string | null>>, opts?: SetFieldsOptions) {
    if (this.failOn.has(pageId)) throw new Error('write failed')
    this.writes.push({ pageId, fields })
    this.optsSeen.push(opts)
    return this.titles.find((t) => t.pageId === pageId)!
  }
}

describe('the watched write is guarded', () => {
  it('only writes done while the live status is still want or doing', async () => {
    const g = new FakeStore([title()])
    await runWatchedOnce(g, fakeJellyfin())
    expect(g.optsSeen).toEqual([{ onlyIfStatus: ['want', 'doing'] }])
  })
})

describe('runWatchedOnce', () => {
  let errSpy: ReturnType<typeof vi.spyOn>
  beforeEach(() => { errSpy = vi.spyOn(console, 'error').mockImplementation(() => {}) })
  afterEach(() => { errSpy.mockRestore() })

  it('marks a watched title done and leaves partly watched ones alone', async () => {
    const g = new FakeStore([
      title(),
      title({ pageId: 'p2', name: '7 Doors', imdb: 'tt2000171' }),
      title({ pageId: 'p3', name: 'ORBIT', type: 'show', imdb: 'tt34000231' }),
      title({ pageId: 'p4', name: 'Clock;Work', type: 'show', imdb: 'tt1900272' }),
      title({ pageId: 'p5', name: 'No imdb', imdb: undefined }),
    ])
    const j = fakeJellyfin()
    expect(await runWatchedOnce(g, j)).toBe(1)
    expect(g.writes).toEqual([{ pageId: 'p1', fields: { status: 'done', finished: '2026-10-07' } }])
  })
  it('marks a fully watched show done from its episode play dates', async () => {
    const items = JSON.parse(readFileSync(join(import.meta.dirname, 'fixtures', 'jellyfin-items.json'), 'utf8')) as { Items: { Id: string; UserData: Record<string, unknown> }[] }
    for (const i of items.Items) if (i.Id === '00000000000000000000000000000003') i.UserData.Played = true
    const f = async (url: string | URL | Request) => {
      const u = String(url)
      const name = u.includes('IncludeItemTypes=Episode') ? 'jellyfin-played-episodes.json' : u.includes('/Items') ? '' : 'jellyfin-users.json'
      return new Response(name ? readFileSync(join(import.meta.dirname, 'fixtures', name), 'utf8') : JSON.stringify(items))
    }
    const j = new Jellyfin({ url: 'http://jf', apiKey: 'k', fetch: f as unknown as typeof globalThis.fetch })
    const g = new FakeStore([title({ pageId: 'p3', name: 'ORBIT', type: 'show', imdb: 'tt34000231' })])
    expect(await runWatchedOnce(g, j)).toBe(1)
    expect(g.writes).toEqual([{ pageId: 'p3', fields: { status: 'done', finished: '2026-10-05' } }])
  })
  it('matches IMDb ids case-insensitively', async () => {
    const g = new FakeStore([title({ imdb: 'TT27000598' })])
    expect(await runWatchedOnce(g, fakeJellyfin())).toBe(1)
  })
  it('does nothing, not even listing titles, when Jellyfin is down', async () => {
    const g = new FakeStore([title()])
    expect(await runWatchedOnce(g, fakeJellyfin(false))).toBe(0)
    expect(g.listCalls).toBe(0)
    expect(g.writes).toEqual([])
  })
  it('keeps going after one write fails', async () => {
    const g = new FakeStore([title(), title({ pageId: 'p2', imdb: 'tt27000598' })])
    g.failOn.add('p1')
    expect(await runWatchedOnce(g, fakeJellyfin())).toBe(1)
    expect(g.writes.map((w) => w.pageId)).toEqual(['p2'])
    expect(errSpy).toHaveBeenCalledOnce()
  })
})

describe('startWatchedLoop', () => {
  beforeEach(() => { vi.useFakeTimers() })
  afterEach(() => { vi.useRealTimers() })

  it('ticks at once and again each interval until stopped', async () => {
    const g = new FakeStore([])
    const stop = startWatchedLoop(g, fakeJellyfin(), 1000)
    await vi.advanceTimersByTimeAsync(0)
    expect(g.listCalls).toBe(1)
    await vi.advanceTimersByTimeAsync(1000)
    expect(g.listCalls).toBe(2)
    stop()
    await vi.advanceTimersByTimeAsync(5000)
    expect(g.listCalls).toBe(2)
  })
  it('never overlaps ticks', async () => {
    let release: () => void = () => {}
    const gate = new Promise<void>((r) => { release = r })
    const g = new FakeStore([])
    g.listTitles = async () => { g.listCalls++; await gate; return [] }
    const stop = startWatchedLoop(g, fakeJellyfin(), 1000)
    await vi.advanceTimersByTimeAsync(3500)
    expect(g.listCalls).toBe(1)
    release()
    await vi.advanceTimersByTimeAsync(1000)
    expect(g.listCalls).toBe(2)
    stop()
  })
})

describe('filling IMDb IDs from Jellyfin', () => {
  let errSpy: ReturnType<typeof vi.spyOn>
  beforeEach(() => { errSpy = vi.spyOn(console, 'error').mockImplementation(() => {}) })
  afterEach(() => { errSpy.mockRestore() })

  it('a title without an ID gets it from a matching Jellyfin item, together with done when that item was played', async () => {
    const g = new FakeStore([title({ imdb: undefined, name: 'Ashvale', year: 2024 })])
    const j = fakeJellyfin()
    await j.refresh()
    const it = j.items().find((i) => i.imdb === 'tt27000598')!
    expect(it).toMatchObject({ name: 'Ashvale', year: 2024, kind: 'movie' })
    await runWatchedOnce(g, j)
    expect(g.writes).toEqual([{ pageId: 'p1', fields: { imdb: 'tt27000598', status: 'done', finished: '2026-10-07' } }])
  })

  it('an unplayed match only gets the ID', async () => {
    const g = new FakeStore([title({ pageId: 'p2', imdb: undefined, name: '7 Doors', year: 2014 })])
    await runWatchedOnce(g, fakeJellyfin())
    expect(g.writes).toEqual([{ pageId: 'p2', fields: { imdb: 'tt2000171' } }])
  })
})
