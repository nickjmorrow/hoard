import { describe, expect, it } from 'vitest'
import type { Title } from '../../src/shared/title.ts'
import type { TitleDetail } from '../../src/server/model.ts'
import { Store } from '../../src/server/store.ts'
import { pageFields, planImport } from './plan.ts'

function page(over: Partial<TitleDetail> = {}): TitleDetail {
  return {
    pageId: 'g-1', pageTitle: 'Blue Lantern (1997)', name: 'Blue Lantern', type: 'movie', status: 'done', tags: ['Anime'],
    year: 1997, notesText: '', createdAt: 1000, updatedAt: 2000, propBlockId: 'b0', notes: [], ...over,
  }
}

function stored(over: Partial<Title> = {}): Title {
  return { pageId: 'w-1', pageTitle: 'Neon Ward (1988)', name: 'Neon Ward', type: 'movie', status: 'want', tags: [], year: 1988, notesText: '', createdAt: 1, updatedAt: 1, ...over }
}

describe('planImport', () => {
  it('a page becomes an import with its id, dates, fields, tags and notes in order', () => {
    const notes = ['Loved it', '  - the score', 'See [[The Heirloom (2018)]]'].map((text, i) => ({ id: `n${i}`, text }))
    const { add, skip } = planImport([page({ rating: 5, rec: 'Priya', genre: ['Animation', 'Thriller'], notes })], [])
    expect(skip).toEqual([])
    expect(add).toEqual([{
      id: 'g-1', name: 'Blue Lantern', type: 'movie', tags: ['Anime'], createdAt: 1000, updatedAt: 2000,
      fields: { status: 'done', rating: '5', rec: 'Priya', year: '1997', genre: 'Animation, Thriller' },
      notes: ['Loved it', '  - the score', 'See [[The Heirloom (2018)]]'],
    }])
  })

  it('skips a page already imported (same id)', () => {
    const { add, skip } = planImport([page()], [stored({ pageId: 'g-1' })])
    expect(add).toEqual([])
    expect(skip).toEqual([{ pageTitle: 'Blue Lantern (1997)', reason: 'already imported' }])
  })

  it('skips a page that duplicates a want-list title by imdb, or by type, name and year', () => {
    const byImdb = page({ pageId: 'g-2', pageTitle: 'Neon Ward', name: 'Neon Ward', year: undefined, imdb: 'TT0090625' })
    const byName = page({ pageId: 'g-3', pageTitle: 'NEON WARD (1988)', name: 'NEON WARD', year: 1988 })
    const { add, skip } = planImport([byImdb, byName], [stored({ imdb: 'tt0090625' })])
    expect(add).toEqual([])
    expect(skip.map((s) => s.reason)).toEqual(['duplicate of a want-list title', 'duplicate of a want-list title'])
  })

  it('a skipped duplicate says what its page carried, so nothing is dropped unseen', () => {
    const notes = [{ id: 'n1', text: 'a' }, { id: 'n2', text: 'b' }]
    const dup = page({ pageId: 'g-7', pageTitle: 'Neon Ward (1988)', name: 'Neon Ward', year: 1988, status: 'done', rating: 5, tags: ['Anime'], notes })
    const { skip } = planImport([dup], [stored()])
    expect(skip).toEqual([{
      pageTitle: 'Neon Ward (1988)', reason: 'duplicate of a want-list title',
      page: { status: 'done', rating: 5, tags: 1, notes: 2 },
    }])
  })

  it('keeps a page that only shares the name with a different year, type or imdb', () => {
    const remake = page({ pageId: 'g-4', pageTitle: 'Neon Ward (2020)', name: 'Neon Ward', year: 2020 })
    const show = page({ pageId: 'g-5', pageTitle: 'Neon Ward (1988) show', name: 'Neon Ward', type: 'show', year: 1988 })
    const other = page({ pageId: 'g-6', pageTitle: 'Neon Ward (1988) other', name: 'Neon Ward', year: 1988, imdb: 'tt9999999' })
    const { add } = planImport([remake, show, other], [stored({ imdb: 'tt0090625' })])
    expect(add.map((a) => a.id)).toEqual(['g-4', 'g-5', 'g-6'])
  })

  it('importing the plan twice adds nothing the second time', () => {
    const store = new Store(':memory:')
    const pages = [page(), page({ pageId: 'g-2', pageTitle: 'Starfall (2021)', name: 'Starfall', year: 2021, imdb: 'tt1000419' })]
    for (const t of planImport(pages, store.listTitles()).add) store.importTitle(t)
    expect(store.listTitles()).toHaveLength(2)
    const again = planImport(pages, store.listTitles())
    expect(again.add).toEqual([])
    expect(again.skip.map((s) => s.reason)).toEqual(['already imported', 'already imported'])
  })
})

describe('pageFields', () => {
  it('writes lists comma-joined and leaves missing fields out', () => {
    expect(pageFields(page({ cast: ['A', 'B'], runtime: 98, rt: 100, summary: 'Lamp maker.', progress: 'S1' })))
      .toEqual({ status: 'done', year: '1997', cast: 'A, B', runtime: '98', rt: '100', summary: 'Lamp maker.', progress: 'S1' })
    expect(pageFields(page({ year: undefined }))).toEqual({ status: 'done' })
  })
})
