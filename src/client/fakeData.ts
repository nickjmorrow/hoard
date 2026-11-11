// Sample library for the fake API (pnpm dev:fake). Invented titles, people and ids.

import type { FieldKey, Title } from '../shared/title.ts'
import type { LookupResult } from './apiTypes.ts'

const DAY = 86_400_000

export interface FakeTitle extends Omit<Title, 'notesText'> {
  notes: { id: string; text: string }[]
  onEdgar?: boolean
}

export function sampleTitles(now: number): FakeTitle[] {
  let n = 0
  const make = (t: Omit<FakeTitle, 'pageId' | 'pageTitle' | 'updatedAt' | 'createdAt' | 'notes' | 'tags'> &
    Partial<Pick<FakeTitle, 'createdAt' | 'notes' | 'tags'>>): FakeTitle => {
    n += 1
    const createdAt = t.createdAt ?? now - (40 - n) * DAY
    return {
      pageId: `page-${n}`,
      pageTitle: t.year === undefined ? t.name : `${t.name} (${t.year})`,
      tags: [],
      notes: [],
      ...t,
      createdAt,
      updatedAt: createdAt,
    }
  }
  return [
    make({
      name: 'Starfall', year: 2021, type: 'movie', status: 'want', tags: ['Watch with Priya'], rec: 'Claude',
      imdb: 'tt1000419', rt: 83, runtime: 155, genre: ['Action', 'Adventure', 'Drama'],
      summary: 'A mining crew finds a fallen star on a frozen moon.',
      onEdgar: true,
    }),
    make({
      name: 'Blue Lantern', year: 1997, type: 'movie', status: 'done', rating: 5, tags: ['Anime', 'Rewatch'],
      imdb: 'tt0100887', rt: 80, runtime: 81, genre: ['Animation', 'Crime', 'Horror'], finished: '2026-08-14',
      notes: [{ id: 'note-bl-1', text: 'Rewatched in August. The lantern scenes still get me.' }],
      onEdgar: true,
    }),
    make({
      name: 'The Party Line', year: 2021, type: 'movie', status: 'done', imdb: 'tt7100666', rt: 81, runtime: 103,
      genre: ['Horror', 'Thriller'], finished: '2026-07-02',
    }),
    make({
      name: 'The Tenants', year: 2001, type: 'movie', status: 'done', tags: ['Rainy Day'], imdb: 'tt0200600',
      rt: 84, runtime: 101, genre: ['Horror', 'Mystery'], onEdgar: true,
    }),
    make({
      name: 'Neon Ward', year: 1988, type: 'movie', status: 'want', tags: ['Anime'], imdb: 'tt0090625', rt: 90,
      runtime: 124, genre: ['Animation', 'Action', 'Drama'],
    }),
    make({
      name: 'Lake House Games', year: 2022, type: 'movie', status: 'done', rating: 5, tags: ['Cozy Mystery'],
      imdb: 'tt8100652', rt: 86, runtime: 95, genre: ['Comedy', 'Horror', 'Mystery'], onEdgar: true,
    }),
    make({ name: 'Echo', year: 2026, type: 'movie', status: 'want', createdAt: now - 2 * 3_600_000 }),
    make({
      name: 'Desk Sergeant', year: 2016, type: 'show', status: 'dropped', tags: ['Mockumentary'], imdb: 'tt4600946',
      runtime: 22, genre: ['Comedy', 'Crime'],
    }),
    make({
      name: 'House Rules', year: 2000, type: 'show', status: 'doing', progress: 'season 23', tags: ['Background'],
      imdb: 'tt0200497', runtime: 60, genre: ['Game-Show', 'Reality-TV'], onEdgar: true,
    }),
    make({
      name: 'Star Courier', year: 1998, type: 'show', status: 'want', rec: 'Maya R', tags: ['Anime'],
      imdb: 'tt0200338', rt: 100, runtime: 24, genre: ['Animation', 'Action', 'Adventure'],
      notes: [{ id: 'note-sc-1', text: 'Maya R says start with episode one and don’t skip the songs.' }],
      onEdgar: true,
    }),
    make({ name: 'The Quiet Harbor', type: 'show', status: 'want', imdb: 'tt13000094', genre: ['Comedy', 'Drama'] }),
    make({
      name: 'Clock;Work', year: 2011, type: 'show', status: 'done', rating: 4, tags: ['Anime'], imdb: 'tt1900272',
      runtime: 24, genre: ['Animation', 'Drama', 'Sci-Fi'],
    }),
    make({ name: 'Gloamwood', year: 2021, type: 'game', status: 'want' }),
  ]
}

/** Tag pages and their groups, in the order the server would list them. */
export const SAMPLE_TAG_GROUPS: [string, string | undefined][] = [
  ['Watch with Priya', 'With'],
  ['Watch with Theo', 'With'],
  ['Cozy Mystery', 'Vibe'],
  ['Rainy Day', 'Vibe'],
  ['Background', 'Vibe'],
  ['Anime', 'Style'],
  ['Mockumentary', 'Style'],
  ['Rewatch', undefined],
]

export interface FakeLookupEntry { type: Title['type']; result: LookupResult; details: Partial<Record<FieldKey, string>> }

export const SAMPLE_LOOKUP: FakeLookupEntry[] = [
  {
    type: 'movie',
    result: { source: 'omdb', id: 'tt33000001', name: 'Echo', year: 2026, detail: 'Rosa Vint' },
    details: { imdb: 'tt33000001', year: '2026', runtime: '108', genre: 'Horror, Thriller', summary: 'A voice on the radio starts answering back.' },
  },
  {
    type: 'movie',
    result: { source: 'omdb', id: 'tt0070991', name: 'Echo', year: 1976, detail: 'Lars Hedman' },
    details: { imdb: 'tt0070991', year: '1976', runtime: '98', genre: 'Drama, Mystery, Thriller', rt: '82', summary: 'A mapmaker hears his own voice echo back from a canyon.' },
  },
  {
    type: 'movie',
    result: { source: 'omdb', id: 'tt1000419', name: 'Starfall', year: 2021, detail: 'Ada Lindqvist' },
    details: { imdb: 'tt1000419', year: '2021', runtime: '155', genre: 'Action, Adventure, Drama', rt: '83' },
  },
  {
    type: 'movie',
    result: { source: 'omdb', id: 'tt0000182', name: 'Starfall', year: 1984, detail: 'Hal Brenner' },
    details: { imdb: 'tt0000182', year: '1984', runtime: '137', genre: 'Action, Adventure, Sci-Fi', rt: '36' },
  },
  {
    type: 'show',
    result: { source: 'omdb', id: 'tt0200338', name: 'Star Courier', year: 1998, detail: 'Ryō Arata' },
    details: { imdb: 'tt0200338', year: '1998', runtime: '24', genre: 'Animation, Action, Adventure' },
  },
]
