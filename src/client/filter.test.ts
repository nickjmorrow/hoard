import { describe, expect, it } from 'vitest'
import { applyFilters, emptyFilters, isNeedsLook, prunePicks, type Filters } from './filter.ts'
import type { TagInfo, TitleWithAvail } from './apiTypes.ts'

const NOW = Date.UTC(2026, 9, 19, 12)
const HOUR = 3_600_000

function t(name: string, extra: Partial<TitleWithAvail> = {}): TitleWithAvail {
  return {
    pageId: name, pageTitle: name, name, type: 'movie', status: 'want', tags: [],
    notesText: '', updatedAt: NOW - 24 * HOUR, createdAt: NOW - 24 * HOUR, onEdgar: null,
    imdb: `tt-${name}`,
    ...extra,
  }
}

const tags: TagInfo[] = [
  { title: 'Cozy Mystery', group: 'Vibe', count: 1 },
  { title: 'Rainy Day', group: 'Vibe', count: 1 },
  { title: 'Watch with Priya', group: 'With', count: 1 },
  { title: 'Comfort', count: 1 },
  { title: 'Rewatch', count: 1 },
]

function f(over: Partial<Filters> = {}): Filters {
  return { ...emptyFilters('movie'), ...over }
}

const names = (xs: TitleWithAvail[]) => xs.map((x) => x.name)

describe('applyFilters', () => {
  it('keeps only the chosen type', () => {
    const xs = [t('Starfall'), t('Courier', { type: 'show' })]
    expect(names(applyFilters(xs, tags, f(), NOW))).toEqual(['Starfall'])
  })

  it('treats two tags in one group as either', () => {
    const xs = [
      t('Supper Club', { tags: ['Cozy Mystery'] }),
      t('The Visitor', { tags: ['Rainy Day'] }),
      t('Neon Ward', { tags: ['Anime'] }),
    ]
    const got = applyFilters(xs, tags, f({ tagsByGroup: { Vibe: ['Cozy Mystery', 'Rainy Day'] } }), NOW)
    expect(names(got).sort()).toEqual(['Supper Club', 'The Visitor'])
  })

  it('requires a match in every group that has picks', () => {
    const xs = [
      t('Supper Club', { tags: ['Cozy Mystery', 'Watch with Priya'] }),
      t('The Lodger', { tags: ['Cozy Mystery'] }),
      t('Starfall', { tags: ['Watch with Priya'] }),
    ]
    const got = applyFilters(xs, tags, f({ tagsByGroup: { Vibe: ['Cozy Mystery'], With: ['Watch with Priya'] } }), NOW)
    expect(names(got)).toEqual(['Supper Club'])
  })

  it('treats ungrouped tags as the group "Other"', () => {
    const xs = [
      t('A', { tags: ['Comfort', 'Cozy Mystery'] }),
      t('B', { tags: ['Rewatch', 'Cozy Mystery'] }),
      t('C', { tags: ['Comfort'] }),
    ]
    const either = applyFilters(xs, tags, f({ tagsByGroup: { Other: ['Comfort', 'Rewatch'] } }), NOW)
    expect(names(either).sort()).toEqual(['A', 'B', 'C'])
    const both = applyFilters(xs, tags, f({ tagsByGroup: { Other: ['Comfort'], Vibe: ['Cozy Mystery'] } }), NOW)
    expect(names(both)).toEqual(['A'])
  })

  it('keeps only onEdgar === true when the On-the-server toggle is on', () => {
    const xs = [t('Yes', { onEdgar: true }), t('No', { onEdgar: false }), t('Unknown', { onEdgar: null })]
    expect(names(applyFilters(xs, tags, f({ onEdgar: true }), NOW))).toEqual(['Yes'])
  })

  it('searches name, rec and notesText case-insensitively', () => {
    const xs = [
      t('Blue Lantern'),
      t('Courier', { rec: 'Maya R' }),
      t('Tenants', { notesText: 'Watched it in a BLUE mood' }),
      t('Neon Ward'),
    ]
    expect(names(applyFilters(xs, tags, f({ search: 'blue' }), NOW)).sort()).toEqual(['Blue Lantern', 'Tenants'])
    expect(names(applyFilters(xs, tags, f({ search: 'maya r' }), NOW))).toEqual(['Courier'])
  })

  it('keeps only the chosen statuses, or every status when none is chosen', () => {
    const xs = [t('A', { status: 'want' }), t('B', { status: 'done' }), t('C', { status: 'doing' })]
    expect(names(applyFilters(xs, tags, f({ statuses: ['want', 'doing'] }), NOW)).sort()).toEqual(['A', 'C'])
    expect(applyFilters(xs, tags, f(), NOW)).toHaveLength(3)
  })

  it('sorts by Rotten Tomatoes, highest first, missing scores last', () => {
    const xs = [t('None'), t('Low', { rt: 40 }), t('High', { rt: 95 })]
    expect(names(applyFilters(xs, tags, f({ sort: 'rt' }), NOW))).toEqual(['High', 'Low', 'None'])
  })

  it('sorts recently added as newest createdAt first', () => {
    const xs = [t('Old', { createdAt: NOW - 3 * HOUR }), t('New', { createdAt: NOW - HOUR }), t('Mid', { createdAt: NOW - 2 * HOUR })]
    expect(names(applyFilters(xs, tags, f({ sort: 'added' }), NOW))).toEqual(['New', 'Mid', 'Old'])
  })

  it('needsLook keeps movies and shows without imdb, once older than 10 minutes', () => {
    const xs = [
      t('Echo', { imdb: undefined, createdAt: NOW - HOUR }),
      t('Just added', { imdb: undefined, createdAt: NOW - 60_000 }),
      t('Starfall'),
    ]
    expect(names(applyFilters(xs, tags, f({ needsLook: true }), NOW))).toEqual(['Echo'])
    expect(isNeedsLook(t('Game', { type: 'game', imdb: undefined, createdAt: NOW - HOUR }), NOW)).toBe(false)
  })

  it('drops a pick whose group was renamed or whose tag moved, so it stops filtering', () => {
    const xs = [t('A', { tags: ['Cozy Mystery'] }), t('B', { tags: ['Watch with Priya'] }), t('C')]
    // "Vibe" was renamed "Mood"; "Watch with Priya" moved from With to Other.
    const now: TagInfo[] = [
      { title: 'Cozy Mystery', group: 'Mood', count: 1 },
      { title: 'Watch with Priya', count: 1 },
      { title: 'Anime', group: 'Style', count: 0 },
    ]
    const stale = { Vibe: ['Cozy Mystery'], With: ['Watch with Priya'], Style: ['Anime', 'Gone'] }
    expect(prunePicks(stale, now)).toEqual({ Style: ['Anime'] })
    const got = applyFilters(xs, now, f({ tagsByGroup: { Vibe: ['Cozy Mystery'], With: ['Watch with Priya'] } }), NOW)
    expect(names(got).sort()).toEqual(['A', 'B', 'C'])
  })
})
