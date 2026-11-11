// The JSON API under /api, plus the built client with SPA fallback.

import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { serveStatic } from '@hono/node-server/serve-static'
import { Hono, type Context } from 'hono'
import { localDate } from '../shared/localDate.ts'
import { MEDIA_TAG, MEDIA_TYPES, STATUSES, type FieldKey, type MediaType, type Title } from '../shared/title.ts'
import type { Library } from './library.ts'
import { NotANoteError, NotFoundError } from './model.ts'
import { LookupUnavailableError } from './lookupError.ts'
import type { Availability, Lookup } from './ports.ts'
import type { Store } from './store.ts'
import { runSuggest, SuggestError, type Suggester } from './suggest.ts'

/** What the API needs from the library; the real class satisfies it and tests pass an in-memory fake. */
export type LibraryPort = Pick<Library,
  | 'listTitles' | 'getTitle' | 'listTags' | 'setFields' | 'setTags' | 'removeFromHoard'
  | 'addNote' | 'editNote' | 'createTitle' | 'setTagGroup' | 'renameGroup'>

export interface AppDeps {
  library: LibraryPort
  availability: Availability
  lookup: Lookup
  /** ms since epoch; injectable so tests get a fixed "today". */
  now?: () => number
  /** Called with the page id of each newly created title (not an existing one), without waiting; main.ts enriches it. */
  onCreated?: (pageId: string) => void
  /** Hoard's store (posters, suggestions); without it the suggestion routes answer 503. */
  store?: Store
  /** Claude, for "suggest more like this". */
  suggester?: Suggester
  /** The built client; defaults to dist/client in this repo. Not served if it doesn't exist. */
  clientDir?: string
}

const FIELD_KEYS: readonly FieldKey[] = [
  'type', 'status', 'rating', 'rec', 'finished', 'progress',
  'imdb', 'year', 'runtime', 'genre', 'rt', 'summary', 'director', 'writer', 'cast',
]

class BadRequest extends Error {}

// ---- validation, all in one place ----

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function str(body: Record<string, unknown>, key: string): string {
  const value = body[key]
  if (typeof value !== 'string' || !value.trim()) throw new BadRequest(`${key} must be a non-empty string`)
  return value
}

function mediaType(value: unknown): MediaType {
  if (!MEDIA_TYPES.includes(value as MediaType)) throw new BadRequest(`unknown type: ${String(value)}`)
  return value as MediaType
}

function strings(value: unknown, key: string): string[] {
  if (!Array.isArray(value) || !value.every((v) => typeof v === 'string')) throw new BadRequest(`${key} must be a list of strings`)
  return value
}

/** A tag name that can sit inside [[...]] on one line: not empty, no brackets or line breaks, not media itself. */
function tagName(tag: string): string {
  if (!tag.trim()) throw new BadRequest('a tag must not be empty')
  if (/\[\[|\]\]|[\r\n]/.test(tag)) throw new BadRequest(`a tag can't contain [[, ]] or a line break: ${JSON.stringify(tag)}`)
  if (tag.trim().toLowerCase() === MEDIA_TAG) throw new BadRequest(`${MEDIA_TAG} is not a tag you can set`)
  return tag
}

function tags(value: unknown): string[] {
  return strings(value, 'tags').map(tagName)
}

/** YYYY-MM-DD that is a real date. */
function isDate(v: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v)
  if (!m) return false
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])))
  return d.toISOString().slice(0, 10) === v
}

/** Format rules for field values, by key. */
const FIELD_FORMATS: Partial<Record<FieldKey, [test: (v: string) => boolean, rule: string]>> = {
  rating: [(v) => /^[1-5]$/.test(v), 'a whole number from 1 to 5'],
  year: [(v) => /^\d{4}$/.test(v), 'a 4-digit year'],
  runtime: [(v) => /^\d+$/.test(v), 'a whole number'],
  rt: [(v) => /^\d+$/.test(v), 'a whole number'],
  finished: [isDate, 'a date as YYYY-MM-DD'],
}

/** A fields object: known keys, string values (or null where allowed), valid type/status/rating. */
function fields(value: unknown, allowNull: true): Partial<Record<FieldKey, string | null>>
function fields(value: unknown, allowNull: false): Partial<Record<FieldKey, string>>
function fields(value: unknown, allowNull: boolean): Partial<Record<FieldKey, string | null>> {
  if (value === undefined) return {}
  if (!isRecord(value)) throw new BadRequest('fields must be an object')
  for (const [key, v] of Object.entries(value)) {
    if (!FIELD_KEYS.includes(key as FieldKey)) throw new BadRequest(`unknown field: ${key}`)
    // Without a type the page would drop out of Hoard, so type can't be removed.
    if (v === null && allowNull && key !== 'type') continue
    if (typeof v !== 'string') throw new BadRequest(`${key} must be a string${allowNull && key !== 'type' ? ' or null' : ''}`)
    if (key === 'type') mediaType(v)
    if (key === 'status' && !STATUSES.includes(v as never)) throw new BadRequest(`unknown status: ${v}`)
    const format = FIELD_FORMATS[key as FieldKey]
    if (format && !format[0](v)) throw new BadRequest(`${key} must be ${format[1]}`)
  }
  return value as Partial<Record<FieldKey, string | null>>
}

async function jsonBody(c: Context): Promise<Record<string, unknown>> {
  let body: unknown
  try {
    body = await c.req.json()
  } catch {
    throw new BadRequest('body must be JSON')
  }
  if (!isRecord(body)) throw new BadRequest('body must be a JSON object')
  return body
}

function plain({ propBlockId: _b, notes: _n, ...title }: Title & { propBlockId?: string; notes?: unknown }): Title {
  return title
}

const notFound = (c: Context) => c.json({ error: 'not found' }, 404)

export function createApp(deps: AppDeps): Hono {
  const { library, availability, lookup } = deps
  const now = deps.now ?? Date.now
  const app = new Hono()

  const onEdgar = (title: Title, up = availability.isUp()) =>
    up && title.imdb ? availability.onEdgar(title.imdb) : null
  /** `{ onEdgar, jellyfinId? }`: the id only for titles Jellyfin has, so the Apple apps can play them. */
  const avail = (title: Title, up = availability.isUp()) => {
    const here = onEdgar(title, up)
    const jellyfinId = here && title.imdb ? availability.jellyfinId(title.imdb) : null
    return { onEdgar: here, ...(jellyfinId ? { jellyfinId } : {}) }
  }

  // A browser sends a cross-site text/plain or form POST without asking first (no CORS preflight),
  // so every write must be JSON, and none may come from another site. A DELETE carries no body.
  app.use('/api/*', async (c, next) => {
    if (c.req.method === 'GET' || c.req.method === 'HEAD') return next()
    const site = c.req.header('sec-fetch-site')
    if (site && site !== 'same-origin' && site !== 'none') return c.json({ error: 'cross-site requests are not allowed' }, 403)
    const type = c.req.header('content-type')?.split(';')[0]!.trim().toLowerCase()
    const bodiless = c.req.method === 'DELETE' && !type
    if (!bodiless && type !== 'application/json') return c.json({ error: 'body must be application/json' }, 415)
    return next()
  })

  app.get('/api/library', async (c) => {
    const [titles, tags] = await Promise.all([library.listTitles(), library.listTags()])
    const jellyfinUp = availability.isUp()
    return c.json({ titles: titles.map((t) => ({ ...t, ...avail(t, jellyfinUp) })), tags, jellyfinUp })
  })

  app.get('/api/titles/:pageId', async (c) => {
    const title = await library.getTitle(c.req.param('pageId'))
    return title ? c.json({ ...title, ...avail(title) }) : notFound(c)
  })

  app.patch('/api/titles/:pageId', async (c) => {
    const pageId = c.req.param('pageId')
    const body = await jsonBody(c)
    const changes = { ...fields(body.fields, true) }
    const newTags = body.tags === undefined ? undefined : tags(body.tags)
    const current = await library.getTitle(pageId)
    if (!current) return notFound(c)
    if (changes.status === 'done' && !('finished' in changes) && current.status !== 'done') {
      changes.finished = localDate(now())
    }
    let title = plain(current)
    if (Object.keys(changes).length) title = await library.setFields(pageId, changes)
    if (newTags) title = await library.setTags(pageId, newTags)
    return c.json(title)
  })

  app.post('/api/titles', async (c) => {
    const body = await jsonBody(c)
    const type = mediaType(body.type)
    const name = str(body, 'name').trim()
    const year = body.year
    if (year !== undefined && !(Number.isInteger(year) && /^\d{4}$/.test(String(year)))) throw new BadRequest('year must be a 4-digit year')
    const imdb = body.imdb === undefined ? undefined : str(body, 'imdb')
    const given = fields(body.fields, false)
    const titleTags = body.tags === undefined ? [] : tags(body.tags)

    const createFields: Partial<Record<FieldKey, string>> = {
      status: 'want',
      ...given,
      ...(imdb ? { imdb } : {}),
    }
    const imdbId = createFields.imdb

    // Same imdb, then the page title: `Name (Year)`, then bare `Name` when a year is given.
    // A page-title match whose own imdb or year differs is a different work.
    const titles = await library.listTitles()
    const wantYear = (year as number | undefined) ?? (createFields.year ? Number(createFields.year) : undefined)
    const conflicts = (t: Title) =>
      (!!imdbId && !!t.imdb && t.imdb !== imdbId) ||
      (wantYear !== undefined && t.year !== undefined && t.year !== wantYear)
    const named = (pageTitle: string) =>
      titles.find((t) => t.pageTitle.toLowerCase() === pageTitle.toLowerCase() && !conflicts(t))
    const existing =
      (imdbId && titles.find((t) => t.imdb === imdbId)) ||
      named(year ? `${name} (${year})` : name) ||
      (year ? named(name) : undefined)
    if (existing) return c.json({ title: existing, existed: true })

    const title = await library.createTitle({
      name,
      ...(year === undefined ? {} : { year: year as number }),
      type,
      fields: createFields,
      tags: titleTags,
    })
    deps.onCreated?.(title.pageId)
    return c.json({ title, existed: false })
  })

  app.post('/api/titles/:pageId/notes', async (c) => {
    const text = str(await jsonBody(c), 'text')
    const pageId = c.req.param('pageId')
    if (!(await library.getTitle(pageId))) return notFound(c)
    const { id } = await library.addNote(pageId, text)
    return c.json({ id, text })
  })

  app.put('/api/notes/:blockId', async (c) => {
    await library.editNote(c.req.param('blockId'), str(await jsonBody(c), 'text'))
    return c.json({ ok: true })
  })

  app.delete('/api/titles/:pageId/hoard', async (c) => {
    const pageId = c.req.param('pageId')
    if (!(await library.getTitle(pageId))) return notFound(c)
    await library.removeFromHoard(pageId)
    return c.json({ ok: true })
  })

  app.post('/api/titles/:pageId/match', async (c) => {
    const id = str(await jsonBody(c), 'id')
    const pageId = c.req.param('pageId')
    const title = await library.getTitle(pageId)
    if (!title) return notFound(c)
    const { poster, ...found } = await lookup.details(title.type, id)
    if (poster && found.imdb) deps.store?.setPoster(found.imdb, poster)
    return c.json(await library.setFields(pageId, found))
  })

  app.get('/api/lookup', async (c) => {
    const type = mediaType(c.req.query('type'))
    const q = c.req.query('q')?.trim()
    return c.json(q ? await lookup.search(type, q) : [])
  })

  app.put('/api/tags/:tag/group', async (c) => {
    const { group } = await jsonBody(c)
    const tag = tagName(c.req.param('tag'))
    if (group !== null && (typeof group !== 'string' || !group.trim())) throw new BadRequest('group must be a non-empty string or null')
    await library.setTagGroup(tag, group)
    return c.json({ ok: true })
  })

  app.post('/api/groups/rename', async (c) => {
    const body = await jsonBody(c)
    await library.renameGroup(str(body, 'from'), str(body, 'to'))
    return c.json({ ok: true })
  })

  // ---- suggestions ----

  const suggestDeps = () => {
    if (!deps.store || !deps.suggester) throw new SuggestError('suggestions are not set up on this server')
    return { store: deps.store, suggester: deps.suggester }
  }

  app.post('/api/suggest', async (c) => {
    const { store, suggester } = suggestDeps()
    const body = await jsonBody(c)
    const all = await library.listTitles()
    const type = body.type === undefined ? undefined : mediaType(body.type)
    if (type === 'game') throw new BadRequest('suggestions are for movies and shows')
    const count = body.count === undefined ? 10 : Number(body.count)
    if (!Number.isInteger(count) || count < 1 || count > 25) throw new BadRequest('count must be a whole number from 1 to 25')
    const prompt = typeof body.prompt === 'string' ? body.prompt : undefined

    let seeds: Title[]
    let source: string
    let tag: string | undefined
    if (typeof body.tag === 'string' && body.tag.trim()) {
      tag = tagName(body.tag)
      const key = tag.toLowerCase()
      seeds = all.filter((t) => t.tags.some((x) => x.toLowerCase() === key))
      source = tag
    } else if (typeof body.person === 'string' && body.person.trim()) {
      const person = body.person.trim()
      seeds = all.filter((t) => [...(t.director ?? []), ...(t.writer ?? [])].includes(person))
      source = person
    } else if (typeof body.genre === 'string' && body.genre.trim()) {
      const genre = body.genre.trim()
      const key = genre.toLowerCase()
      seeds = all.filter((t) => (type === undefined || t.type === type) && (t.genre ?? []).some((g) => g.toLowerCase() === key))
      source = genre
    } else if (body.pageIds !== undefined) {
      const ids = new Set(strings(body.pageIds, 'pageIds'))
      seeds = all.filter((t) => ids.has(t.pageId))
      source = seeds.map((t) => t.name).slice(0, 3).join(', ')
    } else {
      throw new BadRequest('say what to suggest from: tag, person, genre or pageIds')
    }
    if (!seeds.length) throw new BadRequest(`nothing in ${source || 'that selection'} to go on`)
    const made = await runSuggest({ source, seeds, ...(tag ? { tag } : {}), ...(prompt ? { prompt } : {}), ...(type ? { type } : {}), count },
      { suggester, lookup, store, library: all })
    return c.json({ suggestions: made })
  })

  app.get('/api/suggestions', (c) => {
    const { store } = suggestDeps()
    return c.json({ suggestions: store.suggestions('new') })
  })

  app.post('/api/suggestions/:id/keep', async (c) => {
    const { store } = suggestDeps()
    const s = store.suggestion(c.req.param('id'))
    if (!s) return notFound(c)
    const title = await library.createTitle({
      name: s.name,
      ...(s.year ? { year: s.year } : {}),
      type: s.type,
      fields: { ...s.fields, status: 'want', rec: 'Claude' },
      tags: s.tag ? [s.tag] : [],
    })
    store.setSuggestionState(s.id, 'kept')
    return c.json({ title: s.poster ? { ...title, poster: s.poster } : title })
  })

  app.post('/api/suggestions/:id/pass', (c) => {
    const { store } = suggestDeps()
    if (!store.suggestion(c.req.param('id'))) return notFound(c)
    store.setSuggestionState(c.req.param('id'), 'passed')
    return c.json({ ok: true })
  })

  app.all('/api/*', notFound)

  const clientDir = deps.clientDir ?? fileURLToPath(new URL('../../dist/client', import.meta.url))
  if (existsSync(clientDir)) {
    app.get('*', serveStatic({ root: clientDir }))
    app.get('*', serveStatic({ path: `${clientDir}/index.html` }))
  }

  app.onError((err, c) => {
    if (err instanceof BadRequest) return c.json({ error: err.message }, 400)
    if (err instanceof SuggestError) return c.json({ error: err.message }, 502)
    if (err instanceof LookupUnavailableError) return c.json({ error: err.message }, 503)
    if (err instanceof NotFoundError) return c.json({ error: err.message }, 404)
    if (err instanceof NotANoteError) return c.json({ error: err.message }, 400)
    console.error(err)
    return c.json({ error: err.message || 'internal error' }, 500)
  })

  return app
}
