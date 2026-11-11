import { describe, expect, it } from 'vitest'
import { Store, type ImportedTitle } from './store.ts'

function imported(over: Partial<ImportedTitle> = {}): ImportedTitle {
  return {
    id: 'p-1', name: 'Blue Lantern', type: 'movie', fields: { status: 'done', rating: '4', imdb: 'tt1' },
    tags: ['Anime'], notes: ['a', 'b'], createdAt: 1000, updatedAt: 2000, ...over,
  }
}

describe('Store imports', () => {
  it('importTitle keeps id, dates, fields, tags and notes in order', () => {
    const store = new Store(':memory:', () => 1_500)
    store.createTitle({ name: 'Later', type: 'movie', fields: {}, tags: [] })
    expect(store.importTitle(imported())).toBe('added')

    const t = store.getTitle('p-1')!
    expect(t).toMatchObject({ pageId: 'p-1', createdAt: 1000, updatedAt: 2000, rating: 4, status: 'done', imdb: 'tt1', tags: ['Anime'] })
    expect(t.notes.map((n) => n.text)).toEqual(['a', 'b'])
    expect(store.listTitles().map((x) => x.name)).toEqual(['Blue Lantern', 'Later'])
  })

  it('importTitle twice returns exists and changes nothing', () => {
    const store = new Store(':memory:')
    store.importTitle(imported())
    expect(store.importTitle(imported({ fields: { status: 'want' }, notes: ['x'] }))).toBe('exists')
    const t = store.getTitle('p-1')!
    expect(t.status).toBe('done')
    expect(t.notes.map((n) => n.text)).toEqual(['a', 'b'])
    expect(store.listTitles()).toHaveLength(1)
  })

  it('a moved id resolves to its page id', () => {
    const store = new Store(':memory:')
    store.moveTitle('w-1', 'p-1')
    expect(store.resolve('w-1')).toBe('p-1')
    expect(store.resolve('p-9')).toBe('p-9')
  })
})

describe('Store tags', () => {
  it('listTags counts titles case-insensitively and keeps empty grouped tags', () => {
    const store = new Store(':memory:')
    store.createTitle({ name: 'A', type: 'movie', fields: {}, tags: ['Anime'] })
    store.createTitle({ name: 'B', type: 'movie', fields: {}, tags: ['anime'] })
    store.setTagGroup('Space Opera', 'Vibe')
    expect(store.listTags()).toEqual([
      { title: 'Anime', count: 2 },
      { title: 'Space Opera', group: 'Vibe', count: 0 },
    ])
  })

  it('setTagGroup null ungroups; renameGroup moves every tag in the group', () => {
    const store = new Store(':memory:')
    store.createTitle({ name: 'A', type: 'movie', fields: {}, tags: ['Anime', 'Mockumentary'] })
    store.setTagGroup('Anime', 'Style')
    store.setTagGroup('mockumentary', 'Style')
    expect(store.listTags().map((t) => t.group)).toEqual(['Style', 'Style'])

    store.renameGroup('Style', 'Look')
    expect(store.listTags().map((t) => t.group)).toEqual(['Look', 'Look'])

    store.setTagGroup('ANIME', null)
    expect(store.listTags()).toEqual([
      { title: 'Anime', count: 1 },
      { title: 'Mockumentary', group: 'Look', count: 1 },
    ])
  })
})
