// An in-memory stand-in for the server's /api routes (plan, Task 4), used by `pnpm dev:fake`
// until the real server is merged. Same routes, same shapes, same documented behaviours.
//
// Browser switches, read from the page URL on every request:
//   ?jellyfin=down  library answers jellyfinUp: false and onEdgar: null
//   ?fail=writes    every non-GET answers 502 { error }, to see a save roll back

import { MEDIA_TYPES, type MediaType, type Title } from '../shared/title.ts'
import type {
  CreateTitleBody, LibraryResponse, PatchTitleBody, TagInfo, TitleDetailResponse, TitleWithAvail,
} from './apiTypes.ts'
import { FieldError, writeFields, writePatch } from './applyPatch.ts'
import { SAMPLE_LOOKUP, SAMPLE_TAG_GROUPS, sampleTitles, type FakeTitle } from './fakeData.ts'

export const fakeConfig = { latencyMs: 150, jellyfinUp: true, failWrites: false }

let titles: FakeTitle[] = []
/** Tag pages: lowercase name -> { title, group }. */
let tagPages = new Map<string, { title: string; group?: string }>()
let nextId = 1

export function resetFakeApi(now: number = Date.now()): void {
  titles = sampleTitles(now)
  tagPages = new Map(SAMPLE_TAG_GROUPS.map(([title, group]) => [title.toLowerCase(), group ? { title, group } : { title }]))
  nextId = 1
}
resetFakeApi()

class HttpError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}

function urlSwitches(): URLSearchParams {
  return new URLSearchParams(globalThis.location?.search ?? '')
}

function jellyfinUp(): boolean {
  return fakeConfig.jellyfinUp && urlSwitches().get('jellyfin') !== 'down'
}

function toTitle(t: FakeTitle): Title {
  const { notes, onEdgar: _onEdgar, ...rest } = t
  return { ...rest, notesText: notes.map((n) => n.text).join('\n') }
}

function withAvail(t: FakeTitle): TitleWithAvail {
  const known = jellyfinUp() && (t.type === 'movie' || t.type === 'show') && t.imdb !== undefined
  return { ...toTitle(t), onEdgar: known ? t.onEdgar === true : null }
}

function tagInfos(): TagInfo[] {
  const all = new Map(tagPages)
  for (const t of titles) for (const tag of t.tags) if (!all.has(tag.toLowerCase())) all.set(tag.toLowerCase(), { title: tag })
  return [...all.values()].map(({ title, group }) => {
    const count = titles.filter((t) => t.tags.some((x) => x.toLowerCase() === title.toLowerCase())).length
    return group ? { title, group, count } : { title, count }
  })
}

function find(pageId: string): FakeTitle {
  const t = titles.find((x) => x.pageId === pageId)
  if (!t) throw new HttpError(404, `No title page ${pageId}`)
  return t
}

function pageTitleFor(name: string, year?: number): string {
  return year === undefined ? name : `${name} (${year})`
}

async function readBody<T>(init?: RequestInit): Promise<T> {
  if (typeof init?.body !== 'string') throw new HttpError(400, 'Expected a JSON body')
  try {
    return JSON.parse(init.body) as T
  } catch {
    throw new HttpError(400, 'Body is not JSON')
  }
}

async function route(method: string, url: URL, init?: RequestInit): Promise<Response> {
  const path = url.pathname.replace(/\/+$/, '')
  const parts = path.split('/').slice(1).map(decodeURIComponent) // ['api', ...]
  if (parts[0] !== 'api') throw new HttpError(404, `No route ${method} ${path}`)
  const [, a, b, c] = parts
  if (method !== 'GET' && urlSwitches().get('fail') === 'writes') throw new HttpError(502, 'Grimoire didn’t answer')
  if (method !== 'GET' && fakeConfig.failWrites) throw new HttpError(502, 'Grimoire didn’t answer')

  // GET /api/library
  if (method === 'GET' && a === 'library' && b === undefined) {
    const body: LibraryResponse = { titles: titles.map(withAvail), tags: tagInfos(), jellyfinUp: jellyfinUp() }
    return json(body)
  }

  // GET /api/lookup?type=&q=
  if (method === 'GET' && a === 'lookup' && b === undefined) {
    const type = url.searchParams.get('type')
    const q = (url.searchParams.get('q') ?? '').trim().toLowerCase()
    if (!type || !MEDIA_TYPES.includes(type as MediaType)) throw new HttpError(400, 'type must be movie, show or game')
    if (!q || type === 'game') return json([])
    return json(SAMPLE_LOOKUP.filter((e) => e.type === type && e.result.name.toLowerCase().includes(q)).map((e) => e.result))
  }

  if (a === 'titles') {
    // POST /api/titles
    if (method === 'POST' && b === undefined) {
      const body = await readBody<CreateTitleBody>(init)
      if (!MEDIA_TYPES.includes(body.type) || !body.name?.trim()) throw new HttpError(400, 'type and name are required')
      const name = body.name.trim()
      const pageTitle = pageTitleFor(name, body.year)
      const existing =
        (body.imdb ? titles.find((t) => t.imdb === body.imdb) : undefined) ??
        titles.find((t) => t.pageTitle === pageTitle)
      if (existing) return json({ title: toTitle(existing), existed: true })
      const now = Date.now()
      const t: FakeTitle = {
        pageId: `new-${nextId++}`, pageTitle, name, type: body.type, status: 'want', tags: body.tags ?? [],
        notes: [], createdAt: now, updatedAt: now,
        ...(body.year !== undefined ? { year: body.year } : {}),
        ...(body.imdb ? { imdb: body.imdb } : {}),
      }
      writeFields(t, body.fields ?? {}, true)
      titles.push(t)
      return json({ title: toTitle(t), existed: false })
    }

    if (b === undefined) throw new HttpError(404, `No route ${method} ${path}`)
    const t = find(b)

    // GET /api/titles/:pageId
    if (method === 'GET' && c === undefined) {
      const body: TitleDetailResponse = { ...withAvail(t), propBlockId: `${t.pageId}-props`, notes: t.notes.map((n) => ({ ...n })) }
      return json(body)
    }
    // PATCH /api/titles/:pageId
    if (method === 'PATCH' && c === undefined) {
      const body = await readBody<PatchTitleBody>(init)
      writePatch(t, body, true)
      t.updatedAt = Date.now()
      return json(toTitle(t))
    }
    // POST /api/titles/:pageId/notes
    if (method === 'POST' && c === 'notes') {
      const { text } = await readBody<{ text: string }>(init)
      if (!text?.trim()) throw new HttpError(400, 'text is required')
      const note = { id: `note-${nextId++}`, text }
      t.notes.push(note)
      t.updatedAt = Date.now()
      return json(note)
    }
    // DELETE /api/titles/:pageId/hoard  (takes [[media]] off the page)
    if (method === 'DELETE' && c === 'hoard') {
      titles = titles.filter((x) => x !== t)
      return json({ ok: true })
    }
    // POST /api/titles/:pageId/match
    if (method === 'POST' && c === 'match') {
      const { id } = await readBody<{ id: string }>(init)
      const entry = SAMPLE_LOOKUP.find((e) => e.result.id === id)
      if (!entry) throw new HttpError(404, `No lookup result ${id}`)
      writeFields(t, entry.details, true)
      t.updatedAt = Date.now()
      return json(toTitle(t))
    }
  }

  // PUT /api/notes/:blockId
  if (method === 'PUT' && a === 'notes' && b !== undefined && c === undefined) {
    const { text } = await readBody<{ text: string }>(init)
    for (const t of titles) {
      const note = t.notes.find((n) => n.id === b)
      if (note) {
        note.text = text
        t.updatedAt = Date.now()
        return json({ ...note })
      }
    }
    throw new HttpError(404, `No note ${b}`)
  }

  // PUT /api/tags/:tag/group  (creates the tag page if needed)
  if (method === 'PUT' && a === 'tags' && b !== undefined && c === 'group') {
    const { group } = await readBody<{ group: string | null }>(init)
    const existing = tagInfos().find((x) => x.title.toLowerCase() === b.toLowerCase())
    const title = existing?.title ?? b.trim()
    const g = group?.trim()
    tagPages.set(title.toLowerCase(), g ? { title, group: g } : { title })
    return json({ ok: true })
  }

  // POST /api/groups/rename
  if (method === 'POST' && a === 'groups' && b === 'rename') {
    const { from, to } = await readBody<{ from: string; to: string }>(init)
    if (!to?.trim()) throw new HttpError(400, 'to is required')
    for (const page of tagPages.values()) if (page.group === from) page.group = to.trim()
    return json({ ok: true })
  }

  throw new HttpError(404, `No route ${method} ${path}`)
}

/** fetch-compatible: answers /api requests from memory. */
export async function fakeFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const href = input instanceof Request ? input.url : String(input)
  const method = (init?.method ?? (input instanceof Request ? input.method : 'GET')).toUpperCase()
  const url = new URL(href, 'http://hoard.fake')
  if (fakeConfig.latencyMs > 0) await new Promise((r) => setTimeout(r, fakeConfig.latencyMs))
  try {
    return await route(method, url, init)
  } catch (e) {
    if (e instanceof HttpError) return json({ error: e.message }, e.status)
    if (e instanceof FieldError) return json({ error: e.message }, 400)
    return json({ error: e instanceof Error ? e.message : String(e) }, 500)
  }
}
