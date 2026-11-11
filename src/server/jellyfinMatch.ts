// Fills a missing IMDb ID from Jellyfin, which already knows the ID of every movie and show on the server.
// Only a clear match counts: same kind, same name (ignoring case, accents and punctuation), same year
// when the title has one, exactly one candidate, and an ID no other title already uses.

import type { Title } from '../shared/title.ts'
import { normalizeName } from './enricher.ts'
import type { JellyfinItem } from './jellyfin.ts'

export function imdbFromJellyfin(t: Title, items: JellyfinItem[], usedIds: Set<string>): string | null {
  if (t.imdb || (t.type !== 'movie' && t.type !== 'show')) return null
  const name = normalizeName(t.name)
  const candidates = items.filter((i) =>
    i.kind === t.type && i.name !== undefined && normalizeName(i.name) === name &&
    (t.year === undefined || i.year === t.year))
  if (candidates.length !== 1) return null
  const id = candidates[0]!.imdb
  return usedIds.has(id.toLowerCase()) || usedIds.has(id) ? null : id
}
