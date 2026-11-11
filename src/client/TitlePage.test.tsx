// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import { userEvent } from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { Title } from '../shared/title.ts'
import type { LookupResult, TagInfo, TitleWithAvail } from './apiTypes.ts'
import { App } from './App.tsx'
import { Toaster, dismissToast } from './toast.tsx'
import { ON_SERVER } from './serverName.ts'

const HOUR = 3_600_000

interface Call { method: string; path: string; body: unknown }
type Handler = (body: unknown) => Response | Promise<Response>

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}

function title(over: Partial<TitleWithAvail> = {}): TitleWithAvail {
  return {
    pageId: 'p1', pageTitle: 'Below the Ridge (2005)', name: 'Below the Ridge', type: 'movie', status: 'want', tags: [],
    imdb: 'tt0400625', year: 2005, runtime: 99, notesText: '', createdAt: Date.now() - 48 * HOUR,
    updatedAt: Date.now() - 48 * HOUR, onEdgar: null, ...over,
  }
}

const TAGS: TagInfo[] = [{ title: 'Rainy Day', group: 'Vibe', count: 1 }]

/** Stubs fetch with a tiny /api: the library, the title's detail, plus `routes` keyed "METHOD /path". */
function mockApi(t: TitleWithAvail, routes: Record<string, Handler> = {}): Call[] {
  const calls: Call[] = []
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const method = init?.method ?? 'GET'
    const path = String(input)
    const body: unknown = typeof init?.body === 'string' ? JSON.parse(init.body) : undefined
    calls.push({ method, path, body })
    const key = `${method} ${path}`
    const handler = routes[key]
    if (handler) return handler(body)
    if (key === 'GET /api/library') return json({ titles: [t], tags: TAGS, jellyfinUp: true })
    if (key === `GET /api/titles/${t.pageId}`) return json({ ...t, propBlockId: 'props-1', notes: [] })
    return json({ error: `unmocked ${key}` }, 500)
  }))
  return calls
}

const writes = (calls: Call[]) => calls.filter((c) => c.method !== 'GET')

function deferred<T>(): { promise: Promise<T>; resolve: (v: T) => void } {
  let resolve!: (v: T) => void
  const promise = new Promise<T>((r) => { resolve = r })
  return { promise, resolve }
}

function renderAt(path: string) {
  history.pushState(null, '', path)
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  return render(
    <QueryClientProvider client={qc}>
      <App />
      <Toaster />
    </QueryClientProvider>,
  )
}

describe('TitlePage', () => {
  beforeEach(() => {
    sessionStorage.clear()
  })
  afterEach(() => {
    cleanup()
    dismissToast()
    vi.unstubAllGlobals()
  })

  it('lists lookup matches for a Needs a look title and sends the chosen one to match', async () => {
    const t = title({ name: 'Echo', pageTitle: 'Echo (2026)', year: 2026, imdb: undefined, runtime: undefined })
    const results: LookupResult[] = [
      { source: 'omdb', id: 'tt33000001', name: 'Echo', year: 2026, detail: 'Rosa Vint' },
      { source: 'omdb', id: 'tt0070991', name: 'Echo', year: 1976, detail: 'Lars Hedman' },
    ]
    const calls = mockApi(t, {
      'GET /api/lookup?type=movie&q=Echo': () => json(results),
      'POST /api/titles/p1/match': () => json({ ...t, imdb: 'tt0070991', year: 1976 } satisfies Title),
    })
    renderAt('/title/p1')
    const panel = await screen.findByRole('region', { name: 'Needs a look' })
    const pick = await within(panel).findByRole('button', { name: /Lars Hedman/ })
    await userEvent.click(pick)
    await waitFor(() => expect(writes(calls)).toEqual([
      { method: 'POST', path: '/api/titles/p1/match', body: { id: 'tt0070991' } },
    ]))
  })

  it('sends the tapped rating and shows 4 stars before the response', async () => {
    const t = title()
    const answer = deferred<Response>()
    const calls = mockApi(t, { 'PATCH /api/titles/p1': () => answer.promise })
    renderAt('/title/p1')
    await userEvent.click(await screen.findByRole('button', { name: '4 stars' }))
    expect(writes(calls)).toEqual([{ method: 'PATCH', path: '/api/titles/p1', body: { fields: { rating: '4' } } }])
    expect(screen.getByRole('group', { name: 'Rating: 4 of 5' })).toBeTruthy()
    expect(screen.getByRole('button', { name: '4 stars' }).getAttribute('aria-pressed')).toBe('true')
    answer.resolve(json(Object.assign(t, { rating: 4 })))
    await waitFor(() => expect(screen.getByRole('group', { name: 'Rating: 4 of 5' })).toBeTruthy())
  })

  it('puts the old rating back and says so when the save fails', async () => {
    const t = title({ rating: 3 })
    mockApi(t, { 'PATCH /api/titles/p1': () => json({ error: 'Grimoire didn’t answer' }, 502) })
    renderAt('/title/p1')
    await screen.findByRole('group', { name: 'Rating: 3 of 5' })
    await userEvent.click(screen.getByRole('button', { name: '5 stars' }))
    expect(await screen.findByText(/Couldn’t save: Grimoire didn’t answer/)).toBeTruthy()
    expect(screen.getByRole('group', { name: 'Rating: 3 of 5' })).toBeTruthy()
  })

  it('a failed save undoes only its own change, not a later edit still in flight', async () => {
    const t = title({ rating: 3 })
    const first = deferred<Response>()
    const second = deferred<Response>()
    const answers = [first, second]
    mockApi(t, { 'PATCH /api/titles/p1': () => answers.shift()!.promise })
    renderAt('/title/p1')
    await screen.findByRole('group', { name: 'Rating: 3 of 5' })
    await userEvent.click(screen.getByRole('button', { name: '5 stars' }))
    const status = screen.getByRole('group', { name: 'Status' })
    await userEvent.click(within(status).getByRole('button', { name: 'Done' }))
    await waitFor(() => expect(answers).toEqual([]))
    first.resolve(json({ error: 'Grimoire didn’t answer' }, 502))
    expect(await screen.findByText(/Couldn’t save/)).toBeTruthy()
    expect(screen.getByRole('group', { name: 'Rating: 3 of 5' })).toBeTruthy()
    expect(within(status).getByRole('button', { name: 'Done' }).getAttribute('aria-pressed')).toBe('true')
    second.resolve(json(Object.assign(t, { status: 'done', finished: '2026-10-19' })))
    await screen.findByText('Oct 19, 2026')
  })

  it('sends status done when Done is tapped', async () => {
    const t = title()
    const calls = mockApi(t, {
      // The server saves it: later reads of the library see it too.
      'PATCH /api/titles/p1': () => json(Object.assign(t, { status: 'done', finished: '2026-10-19' })),
    })
    renderAt('/title/p1')
    const status = await screen.findByRole('group', { name: 'Status' })
    await userEvent.click(within(status).getByRole('button', { name: 'Done' }))
    expect(writes(calls)).toEqual([{ method: 'PATCH', path: '/api/titles/p1', body: { fields: { status: 'done' } } }])
    expect(await screen.findByText('Oct 19, 2026')).toBeTruthy()
  })

  it('an open page follows its title to the id the server answers with, so later edits save there', async () => {
    const t = title({ pageId: 'w-1' })
    const started = { ...t, pageId: 'g-1', status: 'doing' as const }
    const calls = mockApi(t, {
      'PATCH /api/titles/w-1': () => json(started),
      'GET /api/titles/g-1': () => json({ ...started, propBlockId: 'b1', notes: [] }),
      'PATCH /api/titles/g-1': () => json({ ...started, rating: 4 }),
    })
    renderAt('/title/w-1')
    const status = await screen.findByRole('group', { name: 'Status' })
    await userEvent.click(within(status).getByRole('button', { name: 'Doing' }))
    await waitFor(() => expect(location.pathname).toBe('/title/g-1'))
    await userEvent.click(await screen.findByRole('button', { name: '4 stars' }))
    await waitFor(() => expect(writes(calls).map((c) => c.path)).toEqual(['/api/titles/w-1', '/api/titles/g-1']))
    expect(screen.queryByText(/Couldn’t save/)).toBeNull()
  })

  it('‹ Library goes back rather than adding a step, so Back doesn’t reopen the title', async () => {
    const t = title()
    mockApi(t)
    renderAt('/')
    const depth = history.length
    await userEvent.click(await screen.findByText('Below the Ridge'))
    await userEvent.click(await screen.findByRole('button', { name: '‹ Library' }))
    await waitFor(() => expect(location.pathname).toBe('/'))
    expect(history.length).toBe(depth + 1)
    await screen.findByRole('heading', { name: 'Hoard' })
  })

  it('Add: a game’s year must be 4 digits (or left out) before it can be saved', async () => {
    mockApi(title())
    renderAt('/add')
    await userEvent.click(screen.getByRole('button', { name: 'Game' }))
    await userEvent.type(screen.getByRole('searchbox', { name: 'Name' }), 'Copper Keep')
    const year = screen.getByRole('textbox', { name: /Year/ })
    const save = screen.getByRole('button', { name: 'Save to Hoard' })
    await userEvent.type(year, '20')
    expect(save.hasAttribute('disabled')).toBe(true)
    expect(screen.getByText('A year has 4 digits, like 2021.')).toBeTruthy()
    await userEvent.type(year, '18')
    expect(save.hasAttribute('disabled')).toBe(false)
    await userEvent.clear(year)
    expect(save.hasAttribute('disabled')).toBe(false)
  })

  it('shows On the server only once the library says Jellyfin is answering', async () => {
    const t = title()
    const answer = deferred<Response>()
    mockApi(t, { 'GET /api/library': () => answer.promise })
    renderAt('/')
    await screen.findByText('Loading your library…')
    expect(screen.queryByRole('button', { name: ON_SERVER })).toBeNull()
    answer.resolve(json({ titles: [t], tags: TAGS, jellyfinUp: true }))
    expect(await screen.findByRole('button', { name: ON_SERVER })).toBeTruthy()
  })

  it('asks before Remove from Hoard calls the API, then goes back to the library', async () => {
    const t = title()
    const calls = mockApi(t, { 'DELETE /api/titles/p1/hoard': () => json({ ok: true }) })
    renderAt('/title/p1')
    await userEvent.click(await screen.findByRole('button', { name: 'Remove from Hoard' }))
    const dialog = screen.getByRole('alertdialog')
    expect(within(dialog).getByText('Remove Below the Ridge from Hoard?')).toBeTruthy()
    expect(within(dialog).getByText('Its rating, tags and notes in Hoard are deleted. Anything you wrote in Grimoire stays.')).toBeTruthy()
    expect(writes(calls)).toEqual([])
    await userEvent.click(within(dialog).getByRole('button', { name: 'Remove' }))
    await waitFor(() => expect(location.pathname).toBe('/'))
    expect(writes(calls)).toEqual([{ method: 'DELETE', path: '/api/titles/p1/hoard', body: undefined }])
    await screen.findByRole('heading', { name: 'Hoard' })
    // No refetch of the removed title (it would 404 and flash an error before leaving).
    const afterDelete = calls.slice(calls.findIndex((c) => c.method === 'DELETE') + 1)
    expect(afterDelete.filter((c) => c.path === '/api/titles/p1')).toEqual([])
    expect(screen.queryByText(/Can’t open this title/)).toBeNull()
  })

  it('Add: Enter in the name field doesn’t save; only Save to Hoard does', async () => {
    const t = title()
    const calls = mockApi(t, {
      'GET /api/lookup?type=movie&q=Brand%20New': () => json([]),
      'POST /api/titles': () => json({ title: { ...t, pageId: 'p2', name: 'Brand New' }, existed: false }),
      'GET /api/titles/p2': () => json({ ...t, pageId: 'p2', name: 'Brand New', propBlockId: 'b2', notes: [] }),
    })
    renderAt('/add')
    await userEvent.type(screen.getByRole('searchbox', { name: 'Name' }), 'Brand New{Enter}')
    expect(writes(calls)).toEqual([])
    await userEvent.click(screen.getByRole('button', { name: 'Save to Hoard' }))
    await waitFor(() => expect(location.pathname).toBe('/title/p2'))
    // The new title replaces the Add screen in history: Back won't land on an empty form.
    history.back()
    await waitFor(() => expect(location.pathname).not.toBe('/title/p2'))
    expect(location.pathname).not.toBe('/add')
    expect(writes(calls)).toEqual([{
      method: 'POST', path: '/api/titles', body: { type: 'movie', name: 'Brand New', fields: { status: 'want' } },
    }])
  })
})
