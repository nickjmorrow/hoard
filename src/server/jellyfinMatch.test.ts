import type { Title } from '../shared/title.ts'
import type { JellyfinItem } from './jellyfin.ts'
import { imdbFromJellyfin } from './jellyfinMatch.ts'

const t = (over: Partial<Title> = {}): Title => ({
  pageId: 'p', pageTitle: 'Hollow Pines (2018)', name: 'Hollow Pines', type: 'movie', status: 'want', tags: [], year: 2018,
  notesText: '', updatedAt: 1, createdAt: 1, ...over,
})
const item = (over: Partial<JellyfinItem> = {}): JellyfinItem => ({ imdb: 'tt9200244', played: false, name: 'Hollow Pines', year: 2018, kind: 'movie', ...over })

describe('imdbFromJellyfin', () => {
  test('one item with the same name, year and kind gives its IMDb ID', () => {
    expect(imdbFromJellyfin(t(), [item(), item({ imdb: 'tt1', name: 'Other' })], new Set())).toBe('tt9200244')
  })
  test('names match ignoring case, accents and punctuation', () => {
    expect(imdbFromJellyfin(t({ name: 'Road Kings 2: The Long Haul', year: 1981 }), [item({ name: 'Road Kings 2 - the Long Haul', year: 1981 })], new Set())).toBe('tt9200244')
  })
  test('a different year, a different kind, or two candidates give nothing', () => {
    expect(imdbFromJellyfin(t(), [item({ year: 2019 })], new Set())).toBeNull()
    expect(imdbFromJellyfin(t(), [item({ kind: 'show' })], new Set())).toBeNull()
    expect(imdbFromJellyfin(t({ year: undefined }), [item({ year: 2018 }), item({ imdb: 'tt2', year: 2020 })], new Set())).toBeNull()
  })
  test('without a year, exactly one item of that name and kind is enough', () => {
    expect(imdbFromJellyfin(t({ year: undefined }), [item()], new Set())).toBe('tt9200244')
  })
  test('an ID another title already has is never reused, and games and titles with an ID are skipped', () => {
    expect(imdbFromJellyfin(t(), [item()], new Set(['tt9200244']))).toBeNull()
    expect(imdbFromJellyfin(t({ type: 'game' }), [item()], new Set())).toBeNull()
    expect(imdbFromJellyfin(t({ imdb: 'tt0' }), [item()], new Set())).toBeNull()
  })
})
