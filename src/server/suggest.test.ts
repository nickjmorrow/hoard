import { describe, expect, it } from 'vitest'
import type { Title } from '../shared/title.ts'
import type { Lookup } from './ports.ts'
import { Store } from './store.ts'
import { buildPrompt, parseSuggestions, runSuggest, SuggestError, viewerName, type Suggester } from './suggest.ts'

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
    expect(prompt).toContain('The Long Table (2017); Mirror House (2019); Low Tide (2019)')
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
    const made = await runSuggest({ source: 'Cozy Mystery', tag: 'Cozy Mystery', seeds: library, count: 4 }, { suggester, lookup, store, library })
    expect(made.map((s) => s.name)).toEqual(['Far Field', 'Glass Stairs'])
    expect(made[0]).toMatchObject({ imdb: 'tt10000984', year: 2022, why: 'Halloway again.', tag: 'Cozy Mystery', poster: 'https://img/tt10000984.jpg' })
    expect(made[0]!.fields).toEqual({ imdb: 'tt10000984', year: '2022', director: 'Someone' })
    expect(store.posters().get('tt10000984')).toBe('https://img/tt10000984.jpg')

    // A second round never repeats what was suggested before.
    const again = await runSuggest({ source: 'Cozy Mystery', seeds: library, count: 4 }, { suggester, lookup, store, library })
    expect(again).toEqual([])
  })
})
