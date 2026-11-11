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
})
