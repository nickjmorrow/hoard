// How a PATCH's fields land on a Title, in one place: the optimistic update (queries.ts)
// and the fake API (fakeApi.ts) both use it, so they can't drift apart.

import { MEDIA_TYPES, STATUSES, type FieldKey, type MediaType, type Status, type Title } from '../shared/title.ts'
import type { PatchTitleBody } from './apiTypes.ts'
import { todayLocal } from './dates.ts'

/** The Title properties fields are written to (notesText isn't one). */
export type FieldTarget = Omit<Title, 'notesText'>

type NumberProp = 'rating' | 'year' | 'runtime' | 'rt'
type TextProp = 'rec' | 'finished' | 'progress' | 'imdb' | 'summary'

const NUMBER_PROPS: Partial<Record<FieldKey, NumberProp>> = { rating: 'rating', year: 'year', runtime: 'runtime', rt: 'rt' }
const TEXT_PROPS: Partial<Record<FieldKey, TextProp>> = {
  rec: 'rec', finished: 'finished', progress: 'progress', imdb: 'imdb', summary: 'summary',
}

/** A field value the server would refuse (bad type, status, rating or number). */
export class FieldError extends Error {}

/**
 * Write fields onto `t` in place, the way the server does: null or "" removes a property,
 * genre splits on commas, numbers parse. Invalid values throw FieldError when `strict`,
 * and are skipped otherwise.
 */
export function writeFields(t: FieldTarget, fields: Partial<Record<FieldKey, string | null>>, strict = false): void {
  const bad = (key: string, value: string | null) => {
    if (strict) throw new FieldError(`Bad ${key}: ${value}`)
  }
  for (const [key, raw] of Object.entries(fields) as [FieldKey, string | null | undefined][]) {
    if (raw === undefined) continue
    const value = raw === null ? null : raw.trim()
    if (key === 'type') {
      if (value !== null && MEDIA_TYPES.includes(value as MediaType)) t.type = value as MediaType
      else bad(key, value)
    } else if (key === 'status') {
      if (value !== null && STATUSES.includes(value as Status)) t.status = value as Status
      else bad(key, value)
    } else if (key === 'genre') {
      if (value === null || value === '') delete t.genre
      else t.genre = value.split(',').map((g) => g.trim()).filter(Boolean)
    } else if (NUMBER_PROPS[key]) {
      const prop = NUMBER_PROPS[key]
      if (value === null || value === '') { delete t[prop]; continue }
      const n = Number(value)
      if (!Number.isFinite(n) || (key === 'rating' && (!Number.isInteger(n) || n < 1 || n > 5))) bad(key, value)
      else t[prop] = n
    } else if (TEXT_PROPS[key]) {
      const prop = TEXT_PROPS[key]
      if (value === null || value === '') delete t[prop]
      else t[prop] = value
    }
  }
}

/** A whole PATCH body onto `t` in place: status done without finished also sets finished to today (local time). */
export function writePatch(t: FieldTarget, body: PatchTitleBody, strict = false, now: Date = new Date()): void {
  const fields = { ...body.fields }
  if (fields.status === 'done' && fields.finished === undefined) fields.finished = todayLocal(now)
  writeFields(t, fields, strict)
  if (body.tags) t.tags = [...body.tags]
}

/** A patched copy, for optimistic updates. */
export function applyPatch<T extends FieldTarget>(t: T, body: PatchTitleBody, now: Date = new Date()): T {
  const next = { ...t }
  writePatch(next, body, false, now)
  return next
}
