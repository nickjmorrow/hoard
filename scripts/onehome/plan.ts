// What the one-time import copies from Grimoire into Hoard's store, worked out without touching either.

import { LIST_FIELDS, type FieldKey, type Title } from '../../src/shared/title.ts'
import type { TitleDetail } from '../../src/server/model.ts'
import type { ImportedTitle } from '../../src/server/store.ts'

export interface ImportPlan {
  add: ImportedTitle[]
  /** `page` says what a skipped duplicate's page carried, since none of it reaches the store. */
  skip: {
    pageTitle: string
    reason: 'already imported' | 'duplicate of a want-list title'
    page?: { status: string; rating?: number; tags: number; notes: number }
  }[]
}

/** A title's fields as strings, the way the store keeps them (lists joined with commas). */
export function pageFields(t: Title): Partial<Record<FieldKey, string>> {
  const f: Partial<Record<FieldKey, string>> = { status: t.status }
  if (t.rating !== undefined) f.rating = String(t.rating)
  if (t.rec) f.rec = t.rec
  if (t.finished) f.finished = t.finished
  if (t.progress) f.progress = t.progress
  if (t.imdb) f.imdb = t.imdb
  if (t.year !== undefined) f.year = String(t.year)
  if (t.runtime !== undefined) f.runtime = String(t.runtime)
  if (t.rt !== undefined) f.rt = String(t.rt)
  if (t.summary) f.summary = t.summary
  for (const key of LIST_FIELDS) {
    const items = t[key as 'genre'] as string[] | undefined
    if (items?.length) f[key] = items.join(', ')
  }
  return f
}

const same = (a: string | undefined, b: string | undefined) => (a ?? '').toLowerCase() === (b ?? '').toLowerCase()

/** The same work: the same imdb, or (when neither names a different imdb) the same type, name and year. */
function isSameWork(page: Title, other: Title): boolean {
  if (page.imdb && other.imdb) return same(page.imdb, other.imdb)
  return page.type === other.type && same(page.name, other.name) && page.year === other.year
}

/** Which pages to copy, given what the store already holds. Run again after an import, it adds nothing. */
export function planImport(pages: TitleDetail[], inStore: Title[]): ImportPlan {
  const ids = new Set(inStore.map((t) => t.pageId))
  const plan: ImportPlan = { add: [], skip: [] }
  for (const page of pages) {
    if (ids.has(page.pageId)) {
      plan.skip.push({ pageTitle: page.pageTitle, reason: 'already imported' })
    } else if (inStore.some((t) => isSameWork(page, t))) {
      plan.skip.push({
        pageTitle: page.pageTitle, reason: 'duplicate of a want-list title',
        page: { status: page.status, ...(page.rating !== undefined ? { rating: page.rating } : {}), tags: page.tags.length, notes: page.notes.length },
      })
    } else {
      plan.add.push({
        id: page.pageId, name: page.name, type: page.type, fields: pageFields(page), tags: page.tags,
        notes: page.notes.map((n) => n.text), createdAt: page.createdAt, updatedAt: page.updatedAt,
      })
    }
  }
  return plan
}
