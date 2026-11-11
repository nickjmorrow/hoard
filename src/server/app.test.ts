import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { FieldKey, MediaType, Title } from '../shared/title.ts'
import { LookupUnavailableError } from './lookupError.ts'
import { createApp } from './app.ts'
import { FakeLibrary } from './fakeLibrary.ts'
import { NotANoteError, NotFoundError, type TagInfo, type TitleDetail } from './model.ts'
import type { Availability, Lookup } from './ports.ts'

// 2026-10-19 02:00 UTC is still 2026-10-18 in New York (the test time zone).
const NOW = Date.UTC(2026, 9, 19, 2, 0)

function setup(opts: { up?: boolean } = {}) {
  const library = new FakeLibrary()
  const availability: Availability = {
    isUp: () => opts.up ?? true,
    onEdgar: (imdb) => imdb === 'tt1000419',
    jellyfinId: (imdb) => (imdb === 'tt1000419' ? 'abc123' : null),
  }
  const lookup: Lookup = {
    search: async (type, q) => [{ source: 'omdb', id: 'tt0000182', name: `${q} (${type})`, year: 1984, detail: 'Hal Brenner' }],
    details: async (_type, id) => ({ imdb: id, year: '1984', runtime: '137' }),
  }
  const app = createApp({ library, availability, lookup, now: () => NOW })
  const send = (method: string, path: string, body?: unknown) =>
    app.request(path, {
      method,
      ...(body === undefined ? {} : { body: typeof body === 'string' ? body : JSON.stringify(body), headers: { 'content-type': 'application/json' } }),
    })
  return { library, app, send }
}

describe('GET /api/library', () => {
  test('returns titles with onEdgar, tags and jellyfinUp', async () => {
    const { library, send } = setup()
    library.add({ pageTitle: 'Starfall (2021)', type: 'movie', imdb: 'tt1000419' })
    library.add({ pageTitle: 'Signal Hill (2016)', type: 'movie', imdb: 'tt2000164' })
    library.add({ pageTitle: 'Copper Keep', type: 'game' })
    library.tags = [{ title: 'Cozy Mystery', group: 'Vibe', count: 2 }]
    const res = await send('GET', '/api/library')
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.jellyfinUp).toBe(true)
    expect(body.tags).toEqual([{ title: 'Cozy Mystery', group: 'Vibe', count: 2 }])
    expect(body.titles.map((t: Title & { onEdgar: boolean | null }) => [t.pageTitle, t.onEdgar])).toEqual([
      ['Starfall (2021)', true],
      ['Signal Hill (2016)', false],
      ['Copper Keep', null],
    ])
  })

  test('Jellyfin down gives jellyfinUp false and every onEdgar null', async () => {
    const { library, send } = setup({ up: false })
    library.add({ pageTitle: 'Starfall (2021)', type: 'movie', imdb: 'tt1000419' })
    const body = await (await send('GET', '/api/library')).json()
    expect(body.jellyfinUp).toBe(false)
    expect(body.titles[0].onEdgar).toBeNull()
  })
})

describe('GET /api/titles/:pageId', () => {
  test('returns the detail with onEdgar', async () => {
    const { library, send } = setup()
    const starfall = library.add({ pageTitle: 'Starfall (2021)', type: 'movie', imdb: 'tt1000419', notes: [{ id: 'n1', text: 'Big screen' }] })
    const body = await (await send('GET', `/api/titles/${starfall.pageId}`)).json()
    expect(body).toMatchObject({ pageId: starfall.pageId, onEdgar: true, notes: [{ id: 'n1', text: 'Big screen' }] })
  })

  test('404 for an unknown page', async () => {
    const res = await setup().send('GET', '/api/titles/nope')
    expect(res.status).toBe(404)
    expect(await res.json()).toHaveProperty('error')
  })
})

describe('PATCH /api/titles/:pageId', () => {
  test('status done also sets finished to today in the local time zone', async () => {
    const { library, send } = setup()
    const starfall = library.add({ pageTitle: 'Starfall (2021)', type: 'movie', status: 'doing' })
    const res = await send('PATCH', `/api/titles/${starfall.pageId}`, { fields: { status: 'done' } })
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ status: 'done', finished: '2026-10-18' })
  })

  test('keeps a given finished, and leaves finished alone on a title already done', async () => {
    const { library, send } = setup()
    const a = library.add({ pageTitle: 'A', type: 'movie' })
    expect(await (await send('PATCH', `/api/titles/${a.pageId}`, { fields: { status: 'done', finished: '2026-01-02' } })).json())
      .toMatchObject({ finished: '2026-01-02' })
    const b = library.add({ pageTitle: 'B', type: 'movie', status: 'done' })
    expect(await (await send('PATCH', `/api/titles/${b.pageId}`, { fields: { status: 'done' } })).json())
      .not.toHaveProperty('finished')
  })

  test('applies fields and tags together and returns the final title', async () => {
    const { library, send } = setup()
    const starfall = library.add({ pageTitle: 'Starfall (2021)', type: 'movie' })
    const body = await (await send('PATCH', `/api/titles/${starfall.pageId}`, { fields: { rating: '5', rec: null }, tags: ['Sci-Fi'] })).json()
    expect(body).toMatchObject({ rating: 5, tags: ['Sci-Fi'] })
    expect(library.writes).toEqual([
      `setFields ${starfall.pageId} {"rating":"5","rec":null}`,
      `setTags ${starfall.pageId} ["Sci-Fi"]`,
    ])
  })

  test('400 for a bad rating or status, without writing', async () => {
    const { library, send } = setup()
    const starfall = library.add({ pageTitle: 'Starfall (2021)', type: 'movie' })
    for (const fields of [{ rating: '4.5' }, { rating: '6' }, { status: 'finished' }]) {
      const res = await send('PATCH', `/api/titles/${starfall.pageId}`, { fields })
      expect(res.status).toBe(400)
      expect(await res.json()).toHaveProperty('error')
    }
    expect(library.writes).toEqual([])
  })

  test('404 for an unknown page', async () => {
    expect((await setup().send('PATCH', '/api/titles/nope', { fields: { status: 'done' } })).status).toBe(404)
  })
})

describe('POST /api/titles', () => {
  test('an existing imdb returns existed: true and does not create', async () => {
    const { library, send } = setup()
    library.add({ pageTitle: 'Starfall (2021)', type: 'movie', imdb: 'tt1000419' })
    const res = await send('POST', '/api/titles', { type: 'movie', name: 'Starfall: Part One', imdb: 'tt1000419' })
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ existed: true, title: { pageTitle: 'Starfall (2021)' } })
    expect(library.writes).toEqual([])
  })

  test('an exact page title returns existed: true', async () => {
    const { library, send } = setup()
    library.add({ pageTitle: 'Signal Hill (2016)', type: 'movie' })
    expect(await (await send('POST', '/api/titles', { type: 'movie', name: 'Signal Hill', year: 2016 })).json())
      .toMatchObject({ existed: true, title: { pageTitle: 'Signal Hill (2016)' } })
    expect(library.writes).toEqual([])
  })

  test('"Starfall" 1984 with only "Starfall (2021)" existing creates a new title', async () => {
    const { library, send } = setup()
    library.add({ pageTitle: 'Starfall (2021)', type: 'movie', imdb: 'tt1000419' })
    const res = await send('POST', '/api/titles', { type: 'movie', name: 'Starfall', year: 1984, imdb: 'tt0000182', tags: ['Sci-Fi'] })
    const body = await res.json()
    expect(body).toMatchObject({ existed: false, title: { pageTitle: 'Starfall (1984)', status: 'want', imdb: 'tt0000182', tags: ['Sci-Fi'] } })
    expect(library.writes).toEqual([
      'createTitle {"name":"Starfall","year":1984,"type":"movie","fields":{"status":"want","imdb":"tt0000182"},"tags":["Sci-Fi"]}',
    ])
  })

  test('a yearless title with the bare name matches when a year is given', async () => {
    const { library, send } = setup()
    library.add({ pageTitle: 'The Quiet Harbor', type: 'show' })
    const res = await send('POST', '/api/titles', { type: 'show', name: 'The Quiet Harbor', year: 2021, imdb: 'tt13000094' })
    expect(await res.json()).toMatchObject({ existed: true, title: { pageTitle: 'The Quiet Harbor' } })
    expect(library.writes).toEqual([])
  })

  test('a bare-name title with a different imdb or year is a different work, so a new title is created', async () => {
    const { library, send } = setup()
    library.add({ pageTitle: 'The Quiet Harbor', type: 'show', imdb: 'tt0000001' })
    library.add({ pageTitle: 'Starfall', type: 'movie', year: 2021 })
    for (const body of [
      { type: 'show', name: 'The Quiet Harbor', year: 2021, imdb: 'tt13000094' },
      { type: 'movie', name: 'Starfall', year: 1984 },
    ]) {
      expect(await (await send('POST', '/api/titles', body)).json()).toMatchObject({ existed: false })
    }
    expect(library.writes.map((w) => w.split(' ')[0])).toEqual(['createTitle', 'createTitle'])
  })

  test('the same name and year with a different imdb is a different work: a new title, not a conflict', async () => {
    const { library, send } = setup()
    library.add({ pageTitle: 'Iron Coast (2024)', type: 'show', imdb: 'tt0000002' })
    const res = await send('POST', '/api/titles', { type: 'show', name: 'Iron Coast', year: 2024, imdb: 'tt2700316' })
    expect(res.status).toBe(200)
    expect((await res.json()).existed).toBe(false)
    expect(library.writes.map((w) => w.split(' ')[0])).toEqual(['createTitle'])
  })

  test('keeps a given status', async () => {
    const { library, send } = setup()
    await send('POST', '/api/titles', { type: 'game', name: 'Copper Keep', fields: { status: 'doing' } })
    expect(library.writes).toEqual([
      'createTitle {"name":"Copper Keep","type":"game","fields":{"status":"doing"},"tags":[]}',
    ])
  })

  test('400 for an unknown type, a missing name or bad JSON', async () => {
    const { library, send } = setup()
    expect((await send('POST', '/api/titles', { type: 'podcast', name: 'X' })).status).toBe(400)
    expect((await send('POST', '/api/titles', { type: 'movie', name: '  ' })).status).toBe(400)
    expect((await send('POST', '/api/titles', '{not json')).status).toBe(400)
    expect(library.writes).toEqual([])
  })
})

describe('other writes', () => {
  test('notes, remove from Hoard, tag groups and group rename', async () => {
    const { library, send } = setup()
    const starfall = library.add({ pageTitle: 'Starfall (2021)', type: 'movie' })
    expect(await (await send('POST', `/api/titles/${starfall.pageId}/notes`, { text: 'Loved it' })).json()).toEqual({ id: 'b1', text: 'Loved it' })
    expect((await send('PUT', '/api/notes/b1', { text: 'Loved it a lot' })).status).toBe(200)
    expect((await send('PUT', '/api/tags/Cozy%20Mystery/group', { group: 'Vibe' })).status).toBe(200)
    expect((await send('POST', '/api/groups/rename', { from: 'Vibe', to: 'Mood' })).status).toBe(200)
    expect((await send('DELETE', `/api/titles/${starfall.pageId}/hoard`)).status).toBe(200)
    expect(library.writes).toEqual([
      `addNote ${starfall.pageId} Loved it`,
      'editNote b1 Loved it a lot',
      'setTagGroup Cozy Mystery Vibe',
      'renameGroup Vibe Mood',
      `removeFromHoard ${starfall.pageId}`,
    ])
  })

  test('match writes the lookup details onto the title', async () => {
    const { library, send } = setup()
    const starfall = library.add({ pageTitle: 'Starfall (1984)', type: 'movie' })
    const body = await (await send('POST', `/api/titles/${starfall.pageId}/match`, { id: 'tt0000182' })).json()
    expect(body).toMatchObject({ imdb: 'tt0000182', year: 1984, runtime: 137 })
  })
})

describe('write requests must be JSON from the same site', () => {
  test('a text/plain POST is 415 and writes nothing', async () => {
    const { library, app } = setup()
    const res = await app.request('/api/groups/rename', {
      method: 'POST', body: JSON.stringify({ from: 'Vibe', to: 'Mood' }), headers: { 'content-type': 'text/plain' },
    })
    expect(res.status).toBe(415)
    expect(await res.json()).toHaveProperty('error')
    expect(library.writes).toEqual([])
  })

  test('a POST with no content type, or a form, is 415', async () => {
    const { library, app } = setup()
    const starfall = library.add({ pageTitle: 'Starfall (2021)', type: 'movie' })
    expect((await app.request(`/api/titles/${starfall.pageId}/notes`, { method: 'POST', body: '{"text":"x"}' })).status).toBe(415)
    expect((await app.request(`/api/titles/${starfall.pageId}/notes`, {
      method: 'POST', body: 'text=x', headers: { 'content-type': 'application/x-www-form-urlencoded' },
    })).status).toBe(415)
    expect(library.writes).toEqual([])
  })

  test('application/json with a charset passes', async () => {
    const { library, app } = setup()
    const res = await app.request('/api/groups/rename', {
      method: 'POST', body: JSON.stringify({ from: 'Vibe', to: 'Mood' }), headers: { 'content-type': 'application/json; charset=utf-8' },
    })
    expect(res.status).toBe(200)
    expect(library.writes).toEqual(['renameGroup Vibe Mood'])
  })

  test('a cross-site request is refused, even a DELETE without a body or a JSON POST', async () => {
    const { library, app } = setup()
    const starfall = library.add({ pageTitle: 'Starfall (2021)', type: 'movie' })
    const del = await app.request(`/api/titles/${starfall.pageId}/hoard`, { method: 'DELETE', headers: { 'sec-fetch-site': 'cross-site' } })
    expect(del.status).toBe(403)
    expect(await del.json()).toHaveProperty('error')
    const post = await app.request('/api/groups/rename', {
      method: 'POST', body: JSON.stringify({ from: 'Vibe', to: 'Mood' }),
      headers: { 'content-type': 'application/json', 'sec-fetch-site': 'same-site' },
    })
    expect(post.status).toBe(403)
    expect(library.writes).toEqual([])
  })

  test('same-origin and direct (none) requests pass', async () => {
    const { library, app } = setup()
    const starfall = library.add({ pageTitle: 'Starfall (2021)', type: 'movie' })
    expect((await app.request('/api/groups/rename', {
      method: 'POST', body: JSON.stringify({ from: 'Vibe', to: 'Mood' }),
      headers: { 'content-type': 'application/json', 'sec-fetch-site': 'same-origin' },
    })).status).toBe(200)
    expect((await app.request(`/api/titles/${starfall.pageId}/hoard`, { method: 'DELETE', headers: { 'sec-fetch-site': 'none' } })).status).toBe(200)
    expect(library.writes).toEqual(['renameGroup Vibe Mood', `removeFromHoard ${starfall.pageId}`])
  })
})

describe('tag names', () => {
  const bad = ['', '  ', 'a]]b', '[[x', 'two\nlines', 'media', 'Media']

  test('PATCH and POST refuse empty tags, brackets, newlines and media, writing nothing', async () => {
    const { library, send } = setup()
    const starfall = library.add({ pageTitle: 'Starfall (2021)', type: 'movie' })
    for (const tag of bad) {
      expect((await send('PATCH', `/api/titles/${starfall.pageId}`, { tags: ['Sci-Fi', tag] })).status).toBe(400)
      expect((await send('POST', '/api/titles', { type: 'movie', name: 'Signal Hill', tags: [tag] })).status).toBe(400)
    }
    expect(library.writes).toEqual([])
  })

  test('PUT /api/tags/:tag/group refuses the same tag names', async () => {
    const { library, send } = setup()
    for (const tag of ['%20', 'a%5D%5Db', '%5B%5Bx', 'two%0Alines', 'MEDIA']) {
      expect((await send('PUT', `/api/tags/${tag}/group`, { group: 'Vibe' })).status).toBe(400)
    }
    expect(library.writes).toEqual([])
  })
})

describe('field values', () => {
  test('PATCH refuses type null, an unknown type and malformed year, runtime, rt and finished, writing nothing', async () => {
    const { library, send } = setup()
    const starfall = library.add({ pageTitle: 'Starfall (2021)', type: 'movie' })
    for (const fields of [
      { type: null }, { type: 'podcast' },
      { year: '21' }, { year: '2021.5' }, { year: 'soon' }, { runtime: '2h' }, { runtime: '-5' }, { rt: '83%' },
      { finished: 'yesterday' }, { finished: '2026-1-2' }, { finished: '2026-13-01' },
    ]) {
      const res = await send('PATCH', `/api/titles/${starfall.pageId}`, { fields })
      expect(res.status, JSON.stringify(fields)).toBe(400)
    }
    expect(library.writes).toEqual([])
  })

  test('well-formed values pass, and null still removes them', async () => {
    const { library, send } = setup()
    const starfall = library.add({ pageTitle: 'Starfall (2021)', type: 'movie' })
    const fields = { type: 'show', year: '2021', runtime: '155', rt: '83', finished: '2026-10-18' }
    expect((await send('PATCH', `/api/titles/${starfall.pageId}`, { fields })).status).toBe(200)
    expect((await send('PATCH', `/api/titles/${starfall.pageId}`, { fields: { year: null, runtime: null, rt: null, finished: null } })).status).toBe(200)
  })

  test('POST refuses a malformed year field', async () => {
    const { library, send } = setup()
    expect((await send('POST', '/api/titles', { type: 'movie', name: 'Signal Hill', fields: { year: '16' } })).status).toBe(400)
    expect((await send('POST', '/api/titles', { type: 'game', name: 'Copper Keep', year: 20 })).status).toBe(400)
    expect(library.writes).toEqual([])
  })
})

describe('GET /api/lookup', () => {
  test('passes type and q to the lookup', async () => {
    const body = await (await setup().send('GET', '/api/lookup?type=movie&q=Starfall')).json()
    expect(body).toEqual([{ source: 'omdb', id: 'tt0000182', name: 'Starfall (movie)', year: 1984, detail: 'Hal Brenner' }])
  })

  test('400 for an unknown type', async () => {
    expect((await setup().send('GET', '/api/lookup?type=podcast&q=x')).status).toBe(400)
  })
})

test('an unknown /api route is a JSON 404', async () => {
  const res = await setup().send('GET', '/api/nope')
  expect(res.status).toBe(404)
  expect(await res.json()).toHaveProperty('error')
})

test('serves the built client, falling back to index.html for app routes', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'hoard-client-'))
  try {
    writeFileSync(join(dir, 'index.html'), '<div id="root"></div>')
    writeFileSync(join(dir, 'app.js'), 'console.log(1)')
    const app = createApp({ library: new FakeLibrary(), availability: { isUp: () => false, onEdgar: () => null, jellyfinId: () => null },
      lookup: { search: async () => [], details: async () => ({}) }, clientDir: dir })
    expect(await (await app.request('/app.js')).text()).toBe('console.log(1)')
    const page = await app.request('/title/p1')
    expect(page.headers.get('content-type')).toMatch(/text\/html/)
    expect(await page.text()).toBe('<div id="root"></div>')
    expect((await app.request('/api/nope')).status).toBe(404)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

describe('wiring to background work', () => {
  test('a newly created title is handed to onCreated; an existing one is not', async () => {
    const created: string[] = []
    const library = new FakeLibrary()
    library.add({ pageTitle: 'Starfall (2021)', type: 'movie', imdb: 'tt1000419' })
    const app = createApp({ library, availability: { isUp: () => true, onEdgar: () => null, jellyfinId: () => null },
      lookup: { search: async () => [], details: async () => ({}) }, now: () => NOW, onCreated: (id) => created.push(id) })
    const post = (body: unknown) => app.request('/api/titles', { method: 'POST', body: JSON.stringify(body), headers: { 'content-type': 'application/json' } })
    await post({ type: 'movie', name: 'Starfall', imdb: 'tt1000419' })
    expect(created).toEqual([])
    const res = await post({ type: 'movie', name: 'Signal Hill', year: 2016 })
    const { title } = await res.json() as { title: { pageId: string } }
    expect(created).toEqual([title.pageId])
  })

  test('a lookup outage answers 503 with the message', async () => {
    const app = createApp({ library: new FakeLibrary(), availability: { isUp: () => true, onEdgar: () => null, jellyfinId: () => null },
      lookup: { search: async () => { throw new LookupUnavailableError('OMDb is down') }, details: async () => ({}) } })
    const res = await app.request('/api/lookup?type=movie&q=starfall')
    expect(res.status).toBe(503)
    expect(await res.json()).toEqual({ error: 'OMDb is down' })
  })
})

describe('note errors', () => {
  test('an unknown note answers 404 and the property block answers 400', async () => {
    const library = new FakeLibrary()
    let which = 'missing'
    library.editNote = async () => { throw which === 'missing' ? new NotFoundError('block not found: x') : new NotANoteError('not a note: x') }
    const app = createApp({ library, availability: { isUp: () => true, onEdgar: () => null, jellyfinId: () => null }, lookup: { search: async () => [], details: async () => ({}) } })
    const put = () => app.request('/api/notes/x', { method: 'PUT', body: JSON.stringify({ text: 'hi' }), headers: { 'content-type': 'application/json' } })
    expect((await put()).status).toBe(404)
    which = 'prop'
    expect((await put()).status).toBe(400)
  })
})

describe('jellyfinId on titles', () => {
  test('a title on the server carries its Jellyfin id in the library and the title response; others have none', async () => {
    const library = new FakeLibrary()
    const starfall = library.add({ pageTitle: 'Starfall (2021)', type: 'movie', imdb: 'tt1000419' })
    library.add({ pageTitle: 'Red Meadow (2018)', type: 'movie', imdb: 'tt6900518' })
    const availability = { isUp: () => true, onEdgar: (i: string) => i === 'tt1000419', jellyfinId: (i: string) => (i === 'tt1000419' ? 'abc123' : null) }
    const app = createApp({ library, availability, lookup: { search: async () => [], details: async () => ({}) }, now: () => NOW })
    const lib = await (await app.request('/api/library')).json() as { titles: { pageTitle: string; jellyfinId?: string }[] }
    expect(lib.titles.find((t) => t.pageTitle === 'Starfall (2021)')?.jellyfinId).toBe('abc123')
    expect(lib.titles.find((t) => t.pageTitle === 'Red Meadow (2018)')).not.toHaveProperty('jellyfinId')
    const one = await (await app.request(`/api/titles/${starfall.pageId}`)).json() as { jellyfinId?: string }
    expect(one.jellyfinId).toBe('abc123')
  })
})
