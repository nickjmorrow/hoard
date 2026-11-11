// Filtering and sorting the library in the browser. The whole library is loaded once;
// every filter runs here.

import type { MediaType, Status } from '../shared/title.ts'
import type { TagInfo, TitleWithAvail } from './apiTypes.ts'

export type SortKey = 'rt' | 'year' | 'rating' | 'runtime' | 'added'

export interface Filters {
  type: MediaType
  statuses: Status[]
  /** Picked tags by group name. Picks in one group mean either; picks across groups must all match. */
  tagsByGroup: Record<string, string[]>
  /** On the server (Jellyfin has it) for movies and shows; ignored for games. */
  onEdgar: boolean
  needsLook: boolean
  search: string
  sort: SortKey
}

/** The group ungrouped tags fall into. */
export const OTHER_GROUP = 'Other'

/** How long a new title gets before missing details count as "Needs a look". */
export const NEEDS_LOOK_AFTER_MS = 10 * 60_000

export function emptyFilters(type: MediaType = 'movie'): Filters {
  return { type, statuses: [], tagsByGroup: {}, onEdgar: false, needsLook: false, search: '', sort: 'added' }
}

/** A movie or show without an IMDb id, once it's older than 10 minutes. */
export function isNeedsLook(t: TitleWithAvail, now: number = Date.now()): boolean {
  if (t.createdAt >= now - NEEDS_LOOK_AFTER_MS) return false
  if (t.type === 'movie' || t.type === 'show') return !t.imdb
  return false
}

/** A tag's group, or "Other" when it has none (or isn't known). Keys are lowercase tag names. */
export function groupIndex(tags: TagInfo[]): Map<string, string> {
  return new Map(tags.map((tag) => [tag.title.toLowerCase(), tag.group ?? OTHER_GROUP]))
}

/** Tag groups in the order the server lists them, "Other" last, each with its tags. */
export function groupTags(tags: TagInfo[]): [string, TagInfo[]][] {
  const groups = new Map<string, TagInfo[]>()
  for (const tag of tags) {
    if (tag.group) groups.set(tag.group, [...(groups.get(tag.group) ?? []), tag])
  }
  const other = tags.filter((t) => !t.group)
  return [...groups.entries(), ...(other.length > 0 ? [[OTHER_GROUP, other] as [string, TagInfo[]]] : [])]
}

/**
 * Picks that still name a tag in the group they were picked under. A pick goes stale when its
 * group is renamed or its tag moves to another group: no chip shows it then, so it can't be
 * unchecked, and it must stop filtering. Empty groups are left out.
 */
export function prunePicks(tagsByGroup: Record<string, string[]>, tags: TagInfo[]): Record<string, string[]> {
  const groups = groupIndex(tags)
  const kept: Record<string, string[]> = {}
  for (const [group, picked] of Object.entries(tagsByGroup)) {
    const live = picked.filter((tag) => groups.get(tag.toLowerCase()) === group)
    if (live.length > 0) kept[group] = live
  }
  return kept
}

export function applyFilters(
  titles: TitleWithAvail[],
  tags: TagInfo[],
  f: Filters,
  now: number = Date.now(),
): TitleWithAvail[] {
  // Only live picks count (see prunePicks); picks in one group mean either, across groups all.
  const picks = new Map<string, Set<string>>()
  for (const [group, picked] of Object.entries(prunePicks(f.tagsByGroup, tags))) {
    picks.set(group, new Set(picked.map((x) => x.toLowerCase())))
  }
  const q = f.search.trim().toLowerCase()

  const kept = titles.filter((t) => {
    if (t.type !== f.type) return false
    if (f.statuses.length > 0 && !f.statuses.includes(t.status)) return false
    if (picks.size > 0) {
      const own = new Set(t.tags.map((x) => x.toLowerCase()))
      for (const wanted of picks.values()) {
        if (![...wanted].some((x) => own.has(x))) return false
      }
    }
    if (f.onEdgar) {
      if ((t.type === 'movie' || t.type === 'show') && t.onEdgar !== true) return false
    }
    if (f.needsLook && !isNeedsLook(t, now)) return false
    if (q) {
      const hay = [t.name, t.rec ?? '', t.notesText].join('\n').toLowerCase()
      if (!hay.includes(q)) return false
    }
    return true
  })

  return kept.sort(comparator(f.sort))
}

const SORT_VALUE: Record<Exclude<SortKey, 'added'>, (t: TitleWithAvail) => number | undefined> = {
  rt: (t) => t.rt,
  year: (t) => t.year,
  rating: (t) => t.rating,
  runtime: (t) => t.runtime,
}

/** Runtime sorts shortest first; every other key sorts highest or newest first. Missing values go last. */
export const SORT_ASCENDING: Record<SortKey, boolean> = { rt: false, year: false, rating: false, runtime: true, added: false }

function comparator(sort: SortKey): (a: TitleWithAvail, b: TitleWithAvail) => number {
  const byName = (a: TitleWithAvail, b: TitleWithAvail) => a.name.localeCompare(b.name)
  if (sort === 'added') return (a, b) => b.createdAt - a.createdAt || byName(a, b)
  const value = SORT_VALUE[sort]
  const dir = SORT_ASCENDING[sort] ? 1 : -1
  return (a, b) => {
    const x = value(a)
    const y = value(b)
    if (x === undefined && y === undefined) return byName(a, b)
    if (x === undefined) return 1
    if (y === undefined) return -1
    return (x - y) * dir || byName(a, b)
  }
}
