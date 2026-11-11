import { describe, expect, it } from 'vitest'
import { Library } from './library.ts'
import { Store } from './store.ts'

function setup() {
  const store = new Store(':memory:', () => 1_000)
  return { store, library: new Library(store) }
}

describe('Library', () => {
  it('a title stays the same title through every status, with its notes', async () => {
    const { library } = setup()
    const t = await library.createTitle({ name: 'Mirror House', year: 2019, type: 'movie', fields: { status: 'want', imdb: 'tt6800112' }, tags: ['Cozy Mystery'] })
    expect(t).toMatchObject({ pageTitle: 'Mirror House (2019)', status: 'want', year: 2019, imdb: 'tt6800112', tags: ['Cozy Mystery'] })
    await library.addNote(t.pageId, 'Watch the tunnels scene twice.')

    for (const status of ['doing', 'done', 'dropped'] as const) {
      const next = await library.setFields(t.pageId, { status })
      expect(next).toMatchObject({ pageId: t.pageId, status })
    }
    const detail = await library.getTitle(t.pageId)
    expect(detail?.notes.map((n) => n.text)).toEqual(['Watch the tunnels scene twice.'])
    expect(await library.listTitles()).toHaveLength(1)
  })

  it('lists titles with posters from the store and tag counts', async () => {
    const { store, library } = setup()
    await library.createTitle({ name: 'The Long Table', type: 'movie', fields: { imdb: 'tt5000448' }, tags: ['Cozy Mystery'] })
    await library.createTitle({ name: 'Mirror House', type: 'movie', fields: { imdb: 'tt6800112' }, tags: ['cozy mystery', 'With Priya'] })
    store.setPoster('TT5000448', 'https://img/longtable.jpg')

    const titles = await library.listTitles()
    expect(titles.map((t) => t.name)).toEqual(['The Long Table', 'Mirror House'])
    expect(titles[0]!.poster).toBe('https://img/longtable.jpg')
    expect(await library.listTags()).toEqual([
      { title: 'Cozy Mystery', count: 2 },
      { title: 'With Priya', count: 1 },
    ])
  })

  it('getTitle, setFields, setTags and addNote follow an old w- id to the title it became', async () => {
    const { store, library } = setup()
    const t = await library.createTitle({ name: 'Mirror House', type: 'movie', fields: {}, tags: [] })
    store.moveTitle('w-old', t.pageId)

    expect((await library.getTitle('w-old'))?.pageId).toBe(t.pageId)
    expect(await library.setFields('w-old', { rating: '4' })).toMatchObject({ pageId: t.pageId, rating: 4 })
    expect(await library.setTags('w-old', ['Rewatch'])).toMatchObject({ pageId: t.pageId, tags: ['Rewatch'] })
    await library.addNote('w-old', 'tunnels')
    expect((await library.getTitle(t.pageId))?.notes.map((n) => n.text)).toEqual(['tunnels'])
  })

  it('setFields with onlyIfStatus leaves a dropped title alone', async () => {
    const { library } = setup()
    const t = await library.createTitle({ name: 'Far Field', type: 'movie', fields: { status: 'dropped' }, tags: [] })
    const skipped = await library.setFields(t.pageId, { status: 'done', finished: '2026-10-20' }, { onlyIfStatus: ['want', 'doing'] })
    expect(skipped).toMatchObject({ pageId: t.pageId, status: 'dropped' })
    expect((await library.getTitle(t.pageId))?.status).toBe('dropped')
    const edited = await library.setFields(t.pageId, { rec: 'Claude' })
    expect(edited).toMatchObject({ pageId: t.pageId, rec: 'Claude' })
  })

  it('edits and lists notes, and removing a title deletes it', async () => {
    const { library } = setup()
    const t = await library.createTitle({ name: 'Say It Twice', type: 'movie', fields: {}, tags: [] })
    const { id } = await library.addNote(t.pageId, 'first')
    await library.editNote(id, 'second')
    expect((await library.getTitle(t.pageId))?.notes).toEqual([{ id, text: 'second' }])
    expect((await library.listTitles())[0]!.notesText).toBe('second')
    await library.removeFromHoard(t.pageId)
    expect(await library.getTitle(t.pageId)).toBeNull()
  })

  it('tag groups round-trip through the library', async () => {
    const { library } = setup()
    await library.createTitle({ name: 'Supper Club', type: 'movie', fields: {}, tags: ['Cozy Mystery'] })
    await library.setTagGroup('Cozy Mystery', 'Vibe')
    expect(await library.listTags()).toEqual([{ title: 'Cozy Mystery', group: 'Vibe', count: 1 }])
    await library.renameGroup('Vibe', 'Mood')
    expect((await library.listTags())[0]!.group).toBe('Mood')
  })
})

describe('Store suggestions', () => {
  it('saves, lists new ones and changes state', () => {
    const store = new Store(':memory:', () => 5)
    const [a, b] = store.addSuggestions([
      { name: 'Mirror House', type: 'movie', why: 'Halloway again.', source: 'Cozy Mystery', tag: 'Cozy Mystery', fields: {} },
      { name: 'Glass Stairs', type: 'movie', why: 'Class.', source: 'Cozy Mystery', fields: {} },
    ])
    store.setSuggestionState(a!.id, 'passed')
    expect(store.suggestions('new').map((s) => s.name)).toEqual(['Glass Stairs'])
    expect(store.suggestion(b!.id)?.state).toBe('new')
    expect(store.suggestions().map((s) => s.state).sort()).toEqual(['new', 'passed'])
  })
})
