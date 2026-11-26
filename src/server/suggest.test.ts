import { LookupUnavailableError } from './lookupError.ts'
import { describe, expect, it } from 'vitest'
import type { Title } from '../shared/title.ts'
import type { Lookup } from './ports.ts'
import { Store } from './store.ts'
import { buildPrompt, checkUnverified, parseSuggestions, runSuggest, SuggestError, viewerName, type Suggester } from './suggest.ts'

function title(t: Partial<Title> & { name: string }): Title {
  return { pageId: t.name, pageTitle: t.name, type: 'movie', status: 'want', tags: [], notesText: '', updatedAt: 0, createdAt: 0, ...t }
}

const lookup: Lookup = {
  search: async (_type, q) => (q === 'Far Field' ? [{ source: 'omdb', id: 'tt10000984', name: 'Far Field', year: 2022, detail: '' }]
    : q === 'Glass Stairs' ? [{ source: 'omdb', id: 'tt6700668', name: 'Glass Stairs', year: 2019, detail: '' }] : []),
  details: async (_type, id) => ({ imdb: id, year: id === 'tt10000984' ? '2022' : '2019', director: 'Someone', poster: `https://img/${id}.jpg` }),
}

describe('parseSuggestions', () => {
  it('reads the JSON list, tolerating a fence and stray text', () => {
    const text = 'Here you go:\n```json\n[{"name":"Far Field","year":2022,"type":"movie","why":"Halloway."},{"name":"Overtime","year":"2022","type":"show","why":"Work."},{"why":"no name"}]\n```'
    expect(parseSuggestions(text)).toEqual([
      { name: 'Far Field', year: 2022, type: 'movie', why: 'Halloway.' },
      { name: 'Overtime', year: 2022, type: 'show', why: 'Work.' },
    ])
  })

  it('refuses a reply with no list', () => {
    expect(() => parseSuggestions('Sorry, I can\'t.')).toThrow(SuggestError)
  })
})

describe('buildPrompt', () => {
  it('describes the seeds with their ratings and notes, and lists everything to avoid', () => {
    const longTable = title({ name: 'The Long Table', year: 2017, status: 'done', rating: 5, director: ['June Halloway'], notesText: 'The salt cellar!' })
    const mirror = title({ name: 'Mirror House', year: 2019 })
    const prompt = buildPrompt({ source: 'Cozy Mystery', seeds: [longTable, mirror], count: 8, type: 'movie' }, [longTable, mirror], [
      { id: 's', name: 'Low Tide', year: 2019, type: 'movie', why: '', source: '', fields: {}, state: 'passed', createdAt: 0 },
    ])
    expect(prompt).toContain('"Cozy Mystery"')
    expect(prompt).toContain('The Long Table (2017); movie; watched, rated 5/5; directed by June Halloway; note: "The salt cellar!"')
    expect(prompt).toContain('Mirror House (2019); movie; on the list, not watched yet')
    expect(prompt).toContain('Suggest 8 movies')
    expect(prompt).toContain('never suggest them as new:\nThe Long Table (2017); Mirror House (2019)')
    expect(prompt).toContain('They turned these down; never suggest them: Low Tide (2019)')
    expect(prompt).toContain('"have": true')
  })

  it('names the viewer from HOARD_USER_NAME, else "someone"', () => {
    expect(viewerName({ HOARD_USER_NAME: ' Alice ' })).toBe('Alice')
    expect(viewerName({})).toBe('someone')
    const req = { source: 'Cozy Mystery', seeds: [], count: 3, type: 'movie' as const }
    expect(buildPrompt(req, [], [], 'Alice')).toContain('You recommend movies to Alice, who keeps a careful list of what they watch.')
  })
})

describe('runSuggest', () => {
  it('keeps only real titles not already in the library, with details and posters, tagged with the source', async () => {
    const store = new Store(':memory:')
    const suggester: Suggester = {
      suggest: async () => [
        { name: 'Far Field', year: 2022, type: 'movie', why: 'Halloway again.' },
        { name: 'The Long Table', year: 2017, type: 'movie', why: 'Already has it.' },
        { name: 'Made Up Film', year: 2020, type: 'movie', why: 'Not real.' },
        { name: 'Glass Stairs', year: 2019, type: 'movie', why: 'Class war.' },
      ],
    }
    const library = [title({ name: 'The Long Table', year: 2017, imdb: 'tt5000448', tags: ['Cozy Mystery'] })]
    const { suggestions: made } = await runSuggest({ source: 'Cozy Mystery', tag: 'Cozy Mystery', seeds: library, count: 4 }, { suggester, lookup, store, library })
    expect(made.map((s) => s.name)).toEqual(['Far Field', 'Glass Stairs'])
    expect(made[0]).toMatchObject({ imdb: 'tt10000984', year: 2022, why: 'Halloway again.', tag: 'Cozy Mystery', poster: 'https://img/tt10000984.jpg' })
    expect(made[0]!.fields).toEqual({ imdb: 'tt10000984', year: '2022', director: 'Someone' })
    expect(store.posters().get('tt10000984')).toBe('https://img/tt10000984.jpg')

    // A second round never repeats what was suggested before.
    const again = await runSuggest({ source: 'Cozy Mystery', seeds: library, count: 4 }, { suggester, lookup, store, library })
    expect(again.suggestions).toEqual([])
  })

  it('returns the owned titles Claude picked, matched to the library, never a seed or twice, and never stored', async () => {
    const store = new Store(':memory:')
    const longTable = title({ name: 'The Long Table', year: 2017, pageId: 'p-longtable' })
    const mirror = title({ name: 'Mirror House', year: 2019, pageId: 'p-mirror' })
    const quiet = title({ name: 'Quiet Hours', year: 2022, pageId: 'p-quiet' })
    const suggester: Suggester = {
      suggest: async () => [
        { name: 'Mirror House', year: 2019, type: 'movie', why: 'Halloway too.', have: true },
        { name: 'quiet hours', type: 'movie', why: 'Slow dread.', have: true },
        { name: 'The Long Table', year: 2017, type: 'movie', why: 'A seed.', have: true },
        { name: 'Mirror House', year: 2019, type: 'movie', why: 'Twice.', have: true },
        { name: 'Not Owned', year: 2001, type: 'movie', why: 'Made up.', have: true },
      ],
    }
    const out = await runSuggest({ source: 'The Long Table', seeds: [longTable], count: 4 }, { suggester, lookup, store, library: [longTable, mirror, quiet] })
    expect(out.owned).toEqual([{ pageId: 'p-mirror', why: 'Halloway too.' }, { pageId: 'p-quiet', why: 'Slow dread.' }])
    expect(out.suggestions).toEqual([])
    expect(store.suggestions()).toEqual([])
  })
})

describe('verifySuggestions when OMDb is out', () => {
  it('keeps the rest unchecked instead of failing, still skipping what is in the library', async () => {
    const { verifySuggestions } = await import('./suggest.ts')
    const { LookupUnavailableError } = await import('./lookupError.ts')
    let searches = 0
    const down: Lookup = {
      search: async (_type, q) => {
        searches++
        if (q === 'Far Field') return [{ source: 'omdb', id: 'tt10000984', name: 'Far Field', year: 2022, detail: '' }]
        throw new LookupUnavailableError('OMDb daily limit reached')
      },
      details: async (_type, id) => ({ imdb: id, year: '2022' }),
    }
    const library = [title({ name: 'The Long Table', year: 2017 })]
    const out = await verifySuggestions([
      { name: 'Far Field', year: 2022, type: 'movie', why: 'Halloway.' },
      { name: 'Night Ferry', year: 2022, type: 'movie', why: 'Crossing.' },
      { name: 'The Long Table', year: 2017, type: 'movie', why: 'Has it.' },
      { name: 'Paper Lanterns', year: 2022, type: 'movie', why: 'Festival.' },
    ], down, library, [])
    expect(out.map((s) => [s.name, s.imdb ?? null])).toEqual([['Far Field', 'tt10000984'], ['Night Ferry', null], ['Paper Lanterns', null]])
    expect(out[1]).toMatchObject({ year: 2022, fields: { year: '2022' }, why: 'Crossing.' })
    expect(searches).toBe(2)
  })
})

describe('parseSuggestions', () => {
  it('keeps the have mark on owned picks', () => {
    expect(parseSuggestions('[{"name":"Mirror House","year":2019,"type":"movie","why":"Halloway.","have":true},{"name":"Far Field","type":"movie","why":"New."}]')).toEqual([
      { name: 'Mirror House', year: 2019, type: 'movie', why: 'Halloway.', have: true },
      { name: 'Far Field', type: 'movie', why: 'New.' },
    ])
  })
})

describe('checkUnverified', () => {
  it('fills in an unchecked suggestion once OMDb is back, and leaves checked ones alone', async () => {
    const store = new Store(':memory:')
    const [unchecked] = store.addSuggestions([{ name: 'far field', year: 2022, type: 'movie', why: 'x', source: 'For you', fields: { year: '2022' } }])
    store.addSuggestions([{ name: 'Known', type: 'movie', imdb: 'tt1', why: 'y', source: 'For you', fields: { imdb: 'tt1' }, poster: 'https://img/tt1.jpg' }])
    let searches = 0
    const back: Lookup = {
      search: async () => { searches++; return [{ source: 'omdb', id: 'tt9', name: 'Far Field', year: 2022, detail: '' }] },
      details: async () => ({ imdb: 'tt9', rt: '91', runtime: '101', poster: 'https://img/tt9.jpg' }),
    }
    expect(await checkUnverified(store, back)).toBe(1)
    expect(searches).toBe(1)
    expect(store.suggestion(unchecked!.id)).toMatchObject({ name: 'Far Field', imdb: 'tt9', poster: 'https://img/tt9.jpg', state: 'new', fields: { rt: '91', runtime: '101', imdb: 'tt9' } })
  })

  it("doesn't search again for a day for one OMDb can't find", async () => {
    let clock = 1_000_000
    const store = new Store(':memory:')
    const [lost] = store.addSuggestions([{ name: 'Nowhere Film', type: 'movie', why: 'x', source: 'For you', fields: {} }])
    let searches = 0
    const empty: Lookup = { search: async () => { searches++; return [] }, details: async () => ({}) }
    const now = () => clock
    expect(await checkUnverified(store, empty, { now })).toBe(0)
    expect(await checkUnverified(store, empty, { now })).toBe(0)
    expect(searches).toBe(1)
    expect(store.suggestion(lost!.id)?.state).toBe('new')
    clock += 25 * 3600_000
    await checkUnverified(store, empty, { now })
    expect(searches).toBe(2)
  })

  it('gets the details for one matched while the details call failed, without searching', async () => {
    const store = new Store(':memory:')
    const [half] = store.addSuggestions([{ name: 'Far Field', type: 'movie', imdb: 'tt9', why: 'x', source: 'For you', fields: { imdb: 'tt9' } }])
    let searches = 0
    const back: Lookup = {
      search: async () => { searches++; return [] },
      details: async (_type, id) => ({ imdb: id, runtime: '101', poster: `https://img/${id}.jpg` }),
    }
    expect(await checkUnverified(store, back)).toBe(1)
    expect(searches).toBe(0)
    expect(store.suggestion(half!.id)).toMatchObject({ imdb: 'tt9', poster: 'https://img/tt9.jpg', fields: { runtime: '101' } })
  })

  it('passes on one that turns out to be a title already in the library', async () => {
    const store = new Store(':memory:')
    const [dupe] = store.addSuggestions([{ name: 'The Long Table', type: 'movie', why: 'x', source: 'For you', fields: {} }])
    const found: Lookup = {
      search: async () => [{ source: 'omdb', id: 'tt5', name: 'The Long Table', year: 2017, detail: '' }],
      details: async () => ({ imdb: 'tt5' }),
    }
    await checkUnverified(store, found, { owned: [title({ name: 'The Long Table', year: 2017, imdb: 'tt5' })] })
    expect(store.suggestion(dupe!.id)?.state).toBe('passed')
  })

  it('stops when OMDb is out again', async () => {
    const store = new Store(':memory:')
    store.addSuggestions([
      { name: 'One', type: 'movie', why: 'x', source: 'For you', fields: {} },
      { name: 'Two', type: 'movie', why: 'x', source: 'For you', fields: {} },
    ])
    let searches = 0
    const down: Lookup = { search: async () => { searches++; throw new LookupUnavailableError('out') }, details: async () => ({}) }
    expect(await checkUnverified(store, down)).toBe(0)
    expect(searches).toBe(1)
  })
})
