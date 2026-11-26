import { describe, expect, test } from 'vitest'
import { createApp } from './app.ts'
import { Library } from './library.ts'
import type { Availability, Lookup } from './ports.ts'
import { Store } from './store.ts'
import type { RawSuggestion, Suggester } from './suggest.ts'

function setup(reply: RawSuggestion[] = [{ name: 'Far Field', year: 2022, type: 'movie', why: 'Halloway again.' }]) {
  const store = new Store(':memory:')
  const library = new Library(store)
  const availability: Availability = { isUp: () => true, onEdgar: () => false, jellyfinId: () => null }
  const lookup: Lookup = {
    search: async (_type, q) => [{ source: 'omdb', id: `tt-${q}`, name: q, year: 2022, detail: '' }],
    details: async (_type, id) => ({ imdb: id, year: '2022', poster: `https://img/${id}.jpg` }),
  }
  const prompts: string[] = []
  const suggester: Suggester = { suggest: async (p) => { prompts.push(p); return reply } }
  const app = createApp({ library, availability, lookup, store, suggester })
  const send = (method: string, path: string, body?: unknown) =>
    app.request(path, { method, ...(body === undefined ? {} : { body: JSON.stringify(body), headers: { 'content-type': 'application/json' } }) })
  return { store, library, send, prompts }
}

describe('suggestions', () => {
  test('suggest from a tag, then keep one: it joins the want list with the tag, from Claude', async () => {
    const { library, send, prompts } = setup()
    await library.createTitle({ name: 'The Long Table', year: 2017, type: 'movie', fields: { status: 'done', rating: '5' }, tags: ['Cozy Mystery'] })

    const made = await (await send('POST', '/api/suggest', { tag: 'Cozy Mystery', count: 5 })).json()
    expect(made.suggestions).toHaveLength(1)
    expect(made.suggestions[0]).toMatchObject({ name: 'Far Field', source: 'Cozy Mystery', tag: 'Cozy Mystery', why: 'Halloway again.' })
    expect(prompts[0]).toContain('The Long Table (2017)')

    const inbox = await (await send('GET', '/api/suggestions')).json()
    expect(inbox.suggestions.map((s: { name: string }) => s.name)).toEqual(['Far Field'])

    const kept = await (await send('POST', `/api/suggestions/${made.suggestions[0].id}/keep`, {})).json()
    expect(kept.title).toMatchObject({ name: 'Far Field', status: 'want', rec: 'Claude', tags: ['Cozy Mystery'], poster: 'https://img/tt-Far Field.jpg' })
    expect((await (await send('GET', '/api/suggestions')).json()).suggestions).toEqual([])

    const lib = await (await send('GET', '/api/library')).json()
    expect(lib.titles.map((t: { name: string }) => t.name).sort()).toEqual(['Far Field', 'The Long Table'])
  })

  test('pass removes it from the inbox; an empty tag or no source is a 400', async () => {
    const { library, send } = setup()
    await library.createTitle({ name: 'Mirror House', type: 'movie', fields: {}, tags: ['Cozy Mystery'] })
    const made = await (await send('POST', '/api/suggest', { tag: 'Cozy Mystery' })).json()
    expect((await send('POST', `/api/suggestions/${made.suggestions[0].id}/pass`, {})).status).toBe(200)
    expect((await (await send('GET', '/api/suggestions')).json()).suggestions).toEqual([])
    expect((await send('POST', '/api/suggest', { tag: 'Nothing Here' })).status).toBe(400)
    expect((await send('POST', '/api/suggest', {})).status).toBe(400)
    expect((await send('POST', '/api/suggestions/nope/keep', {})).status).toBe(404)
  })

  test('suggest from a person uses the titles they directed or wrote', async () => {
    const { library, send, prompts } = setup()
    await library.createTitle({ name: 'The Long Table', type: 'movie', fields: { status: 'done', director: 'June Halloway' }, tags: [] })
    await library.createTitle({ name: 'Starfall', type: 'movie', fields: { status: 'done', director: 'Ada Lindqvist' }, tags: [] })
    const res = await send('POST', '/api/suggest', { person: 'June Halloway' })
    expect(res.status).toBe(200)
    expect(prompts[0]).toContain('"June Halloway"')
    expect(prompts[0]).toContain('- The Long Table; movie')
    expect(prompts[0]).not.toContain('- Starfall')
  })

  test('suggest from a genre uses titles of that genre and type, and kept ones get no tag', async () => {
    const { library, send, prompts } = setup()
    await library.createTitle({ name: 'The Heirloom', type: 'movie', fields: { status: 'done', genre: 'Drama, Horror' }, tags: [] })
    await library.createTitle({ name: 'Starfall', type: 'movie', fields: { status: 'done', genre: 'Sci-Fi' }, tags: [] })
    await library.createTitle({ name: 'Toybox', type: 'show', fields: { status: 'want', genre: 'Horror' }, tags: [] })
    const made = await (await send('POST', '/api/suggest', { genre: 'horror', type: 'movie' })).json()
    expect(made.suggestions[0]).toMatchObject({ name: 'Far Field', source: 'horror' })
    expect(made.suggestions[0].tag).toBeUndefined()
    expect(prompts[0]).toContain('- The Heirloom; movie')
    expect(prompts[0]).not.toContain('- Starfall')
    expect(prompts[0]).not.toContain('- Toybox')
    expect((await send('POST', '/api/suggest', { genre: 'Western' })).status).toBe(400)
  })

  test('a kept suggestion is handed to onCreated, like any new title', async () => {
    const store = new Store(':memory:')
    const library = new Library(store)
    await library.createTitle({ name: 'Mirror House', type: 'movie', fields: {}, tags: ['Cozy Mystery'] })
    const created: string[] = []
    const app = createApp({
      library, store, onCreated: (id) => created.push(id),
      availability: { isUp: () => true, onEdgar: () => false, jellyfinId: () => null },
      lookup: { search: async (_type, q) => [{ source: 'omdb', id: `tt-${q}`, name: q, year: 2022, detail: '' }], details: async (_type, id) => ({ imdb: id }) },
      suggester: { suggest: async () => [{ name: 'Far Field', year: 2022, type: 'movie', why: 'Halloway.' }] },
    })
    const send = (path: string, body: unknown) => app.request(path, { method: 'POST', body: JSON.stringify(body), headers: { 'content-type': 'application/json' } })
    const made = await (await send('/api/suggest', { tag: 'Cozy Mystery' })).json()
    const kept = await (await send(`/api/suggestions/${made.suggestions[0].id}/keep`, {})).json()
    expect(created).toEqual([kept.title.pageId])
  })

  test('restore puts a passed suggestion back in the inbox', async () => {
    const { library, send } = setup()
    await library.createTitle({ name: 'Mirror House', type: 'movie', fields: {}, tags: ['Cozy Mystery'] })
    const made = await (await send('POST', '/api/suggest', { tag: 'Cozy Mystery' })).json()
    await send('POST', `/api/suggestions/${made.suggestions[0].id}/pass`, {})
    expect((await send('POST', `/api/suggestions/${made.suggestions[0].id}/restore`, {})).status).toBe(200)
    expect((await (await send('GET', '/api/suggestions')).json()).suggestions.map((s: { name: string }) => s.name)).toEqual(['Far Field'])
    expect((await send('POST', '/api/suggestions/nope/restore', {})).status).toBe(404)
  })

  test('keeping the same suggestion twice adds it once', async () => {
    const { library, send } = setup()
    await library.createTitle({ name: 'Mirror House', type: 'movie', fields: {}, tags: ['Cozy Mystery'] })
    const made = await (await send('POST', '/api/suggest', { tag: 'Cozy Mystery' })).json()
    const id = made.suggestions[0].id
    expect((await send('POST', `/api/suggestions/${id}/keep`, {})).status).toBe(200)
    expect((await send('POST', `/api/suggestions/${id}/keep`, {})).status).toBe(409)
    expect((await library.listTitles()).filter((t) => t.name === 'Far Field')).toHaveLength(1)
  })

  test('ask: a question in plain words gets owned titles that answer it and new ones, from the whole library', async () => {
    const { library, send, prompts } = setup([
      { name: 'Far Field', year: 2022, type: 'movie', why: 'Snowbound and slow.' },
      { name: 'Cold Harbor', year: 2015, type: 'movie', why: 'Set in a frozen town.', have: true },
    ])
    await library.createTitle({ name: 'Cold Harbor', year: 2015, type: 'movie', fields: { status: 'want' }, tags: ['Winter'] })

    const made = await (await send('POST', '/api/suggest', { ask: 'cozy winter horror' })).json()
    expect(made.suggestions.map((s: { name: string; source: string }) => [s.name, s.source])).toEqual([['Far Field', 'cozy winter horror']])
    expect(made.owned).toHaveLength(1)
    expect(made.owned[0].why).toBe('Set in a frozen town.')
    expect(prompts[0]).toContain('They asked: "cozy winter horror"')
    expect(prompts[0]).toContain('Cold Harbor (2015); movie; tags: Winter')
  })

  test('For You goes from recent liked titles and only offers owned titles not watched yet', async () => {
    const { library, send, prompts } = setup([
      { name: 'Far Field', year: 2022, type: 'movie', why: 'Like your recent favorites.' },
      { name: 'Seen Before', year: 2010, type: 'movie', why: 'x', have: true },
      { name: 'Up Next', year: 2012, type: 'movie', why: 'Waiting on your list.', have: true },
    ])
    await library.createTitle({ name: 'Loved Lately', year: 2020, type: 'movie', fields: { status: 'done', rating: '5', finished: '2026-11-01' }, tags: [] })
    await library.createTitle({ name: 'Seen Before', year: 2010, type: 'movie', fields: { status: 'done', rating: '3' }, tags: [] })
    await library.createTitle({ name: 'Up Next', year: 2012, type: 'movie', fields: { status: 'want' }, tags: [] })

    const made = await (await send('POST', '/api/suggest', { forYou: true, count: 25 })).json()
    expect(made.suggestions[0]).toMatchObject({ name: 'Far Field', source: 'For you' })
    expect(made.owned.map((o: { why: string }) => o.why)).toEqual(['Waiting on your list.'])
    expect(prompts[0]).toContain('Loved Lately (2020); movie; watched, rated 5/5')
  })

  test('For You with nothing rated yet says so', async () => {
    const { send } = setup()
    expect((await send('POST', '/api/suggest', { forYou: true })).status).toBe(400)
  })
})
