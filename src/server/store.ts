// Hoard's own store: every title with its fields, tags and notes, the tag groups, Claude's
// suggestions, and poster URLs. Titles moved here from older Grimoire pages keep their ids
// (see library.ts). SQLite through node:sqlite, so there's nothing to install.

import { randomUUID } from 'node:crypto'
import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { LIST_FIELDS, type FieldKey, type MediaType, type Title } from '../shared/title.ts'
import { normalizeRating, normalizeStatus } from '../shared/titleFormat.ts'
import { NotANoteError, NotFoundError, type TagInfo, type TitleDetail } from './model.ts'

/** Store title ids start with this, so the library can tell them from Grimoire page ids. */
export const STORED_PREFIX = 'w-'
const NOTE_PREFIX = 'wn-'

export function isStoredId(id: string): boolean {
  return id.startsWith(STORED_PREFIX)
}

export type SuggestionState = 'new' | 'kept' | 'passed'

export interface Suggestion {
  id: string
  name: string
  year?: number
  type: MediaType
  imdb?: string
  /** Why Claude thinks the user would like it, one sentence. */
  why: string
  /** What it was suggested from, for the inbox: "Cozy Mystery", "June Halloway", "The Long Table, Mirror House". */
  source: string
  /** The tag a kept suggestion gets, when it came from a tag. */
  tag?: string
  /** Looked-up details, as page fields. */
  fields: Partial<Record<FieldKey, string>>
  poster?: string
  state: SuggestionState
  createdAt: number
}

interface TitleDoc {
  name: string
  type: MediaType
  /** Page-style properties (`status`, `year`, `genre`...), values as they'd be written on a page. */
  props: Partial<Record<FieldKey, string>>
  tags: string[]
}

/** A title copied in whole from elsewhere (the Grimoire import): its id and dates are kept. */
export interface ImportedTitle {
  id: string
  name: string
  type: MediaType
  fields: Partial<Record<FieldKey, string>>
  tags: string[]
  notes: string[]
  createdAt: number
  updatedAt: number
}

interface TitleRow { id: string; doc: string; created_at: number; updated_at: number }
interface NoteRow { id: string; title_id: string; text: string }
interface SuggestionRow { id: string; doc: string; state: SuggestionState; created_at: number }

function int(raw?: string): number | undefined {
  return raw && /^\d+$/.test(raw.trim()) ? Number(raw.trim()) : undefined
}

function list(raw?: string): string[] | undefined {
  const items = raw?.split(',').map((s) => s.trim()).filter(Boolean)
  return items?.length ? items : undefined
}

export class Store {
  private db: DatabaseSync
  private now: () => number

  /** `path` is a file, or ':memory:' for tests. */
  constructor(path: string, now: () => number = Date.now) {
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true })
    this.db = new DatabaseSync(path)
    this.now = now
    this.db.exec(`
      pragma journal_mode = wal;
      create table if not exists titles (id text primary key, doc text not null, created_at integer not null, updated_at integer not null);
      create table if not exists notes (id text primary key, title_id text not null, text text not null, created_at integer not null);
      create table if not exists suggestions (id text primary key, doc text not null, state text not null, created_at integer not null);
      create table if not exists posters (imdb text primary key, url text not null);
      create table if not exists moved (id text primary key, page_id text not null);
      create table if not exists tag_groups (tag text primary key collate nocase, grp text not null);
    `)
  }

  // ---- titles ----

  listTitles(): Title[] {
    const rows = this.db.prepare('select * from titles order by created_at').all() as unknown as TitleRow[]
    const notes = this.allNotes()
    return rows.map((r) => this.toTitle(r, notes.get(r.id) ?? []))
  }

  getTitle(id: string): TitleDetail | null {
    const row = this.row(id)
    if (!row) return null
    const notes = (this.db.prepare('select * from notes where title_id = ? order by created_at, rowid').all(id) as unknown as NoteRow[])
      .map((n) => ({ id: n.id, text: n.text }))
    return { ...this.toTitle(row, notes.map((n) => n.text)), propBlockId: '', notes }
  }

  createTitle(input: { name: string; year?: number; type: MediaType; fields: Partial<Record<FieldKey, string>>; tags: string[] }): Title {
    const id = STORED_PREFIX + randomUUID()
    const props: Partial<Record<FieldKey, string>> = { status: 'want' }
    for (const [key, value] of Object.entries(input.fields) as [FieldKey, string][]) {
      if (key !== 'type' && value?.trim()) props[key] = value.trim()
    }
    if (input.year !== undefined && !props.year) props.year = String(input.year)
    const doc: TitleDoc = { name: input.name.trim(), type: input.type, props, tags: dedupe(input.tags) }
    const t = this.now()
    this.db.prepare('insert into titles (id, doc, created_at, updated_at) values (?, ?, ?, ?)').run(id, JSON.stringify(doc), t, t)
    return this.getTitleOrThrow(id)
  }

  setFields(id: string, fields: Partial<Record<FieldKey, string | null>>): Title {
    const doc = this.doc(id)
    for (const [key, value] of Object.entries(fields) as [FieldKey, string | null][]) {
      if (key === 'type') { if (value) doc.type = value as MediaType; continue }
      if (value === null || !value.trim()) delete doc.props[key]
      else doc.props[key] = value.replace(/\s*[\r\n]+\s*/g, ' ').trim()
    }
    this.save(id, doc)
    return this.getTitleOrThrow(id)
  }

  setTags(id: string, tags: string[]): Title {
    const doc = this.doc(id)
    doc.tags = dedupe(tags)
    this.save(id, doc)
    return this.getTitleOrThrow(id)
  }

  deleteTitle(id: string): void {
    this.db.prepare('delete from notes where title_id = ?').run(id)
    this.db.prepare('delete from titles where id = ?').run(id)
  }

  /** Drop a title that now has a Grimoire page, remembering the page so its old id still finds it. */
  moveTitle(id: string, pageId: string): void {
    this.deleteTitle(id)
    this.db.prepare('insert or replace into moved (id, page_id) values (?, ?)').run(id, pageId)
  }

  /** The Grimoire page a moved title went to. */
  movedTo(id: string): string | undefined {
    const row = this.db.prepare('select page_id from moved where id = ?').get(id) as { page_id: string } | undefined
    return row?.page_id
  }

  /** Where a title lives now: a moved title's page id, else `id` itself. */
  resolve(id: string): string {
    return this.movedTo(id) ?? id
  }

  /** Add a title with the id and dates it already has. An id that's already here changes nothing. */
  importTitle(t: ImportedTitle): 'added' | 'exists' {
    if (this.row(t.id)) return 'exists'
    const props: Partial<Record<FieldKey, string>> = { status: 'want' }
    for (const [key, value] of Object.entries(t.fields) as [FieldKey, string][]) {
      if (key !== 'type' && value?.trim()) props[key] = value.replace(/\s*[\r\n]+\s*/g, ' ').trim()
    }
    const doc: TitleDoc = { name: t.name.trim(), type: t.type, props, tags: dedupe(t.tags) }
    this.db.exec('begin')
    try {
      this.db.prepare('insert into titles (id, doc, created_at, updated_at) values (?, ?, ?, ?)').run(t.id, JSON.stringify(doc), t.createdAt, t.updatedAt)
      const insert = this.db.prepare('insert into notes (id, title_id, text, created_at) values (?, ?, ?, ?)')
      t.notes.forEach((text, i) => insert.run(NOTE_PREFIX + randomUUID(), t.id, text, t.createdAt + i))
      this.db.exec('commit')
    } catch (err) {
      this.db.exec('rollback')
      throw err
    }
    return 'added'
  }

  addNote(id: string, text: string): { id: string } {
    if (!text.trim()) throw new Error('a note needs some text')
    if (!this.row(id)) throw new NotFoundError(`no such title: ${id}`)
    const noteId = NOTE_PREFIX + randomUUID()
    this.db.prepare('insert into notes (id, title_id, text, created_at) values (?, ?, ?, ?)').run(noteId, id, text, this.now())
    this.touch(id)
    return { id: noteId }
  }

  ownsNote(noteId: string): boolean {
    return noteId.startsWith(NOTE_PREFIX)
  }

  editNote(noteId: string, text: string): void {
    const note = this.db.prepare('select * from notes where id = ?').get(noteId) as unknown as NoteRow | undefined
    if (!note) throw new NotFoundError(`note not found: ${noteId}`)
    if (!text.trim()) throw new NotANoteError('a note needs some text')
    this.db.prepare('update notes set text = ? where id = ?').run(text, noteId)
    this.touch(note.title_id)
  }

  /** Finish and close the database file; the store can't be used afterwards. */
  close(): void {
    this.db.close()
  }

  // ---- backup ----

  /** A consistent copy of the whole store at `path`, which must not exist yet. */
  backupTo(path: string): void {
    this.db.prepare('vacuum into ?').run(path)
  }

  // ---- tags ----

  /** Every tag a title uses, with how many titles use it, plus grouped tags no title uses yet. */
  listTags(): TagInfo[] {
    const groups = new Map((this.db.prepare('select tag, grp from tag_groups').all() as unknown as { tag: string; grp: string }[])
      .map((r) => [r.tag.toLowerCase(), r.grp]))
    const tags = new Map<string, TagInfo>()
    for (const title of this.listTitles()) {
      for (const tag of title.tags) {
        const key = tag.toLowerCase()
        const entry = tags.get(key) ?? { title: tag, count: 0 }
        entry.count++
        tags.set(key, entry)
      }
    }
    for (const r of this.db.prepare('select tag from tag_groups').all() as unknown as { tag: string }[]) {
      if (!tags.has(r.tag.toLowerCase())) tags.set(r.tag.toLowerCase(), { title: r.tag, count: 0 })
    }
    return [...tags.entries()]
      .map(([key, t]) => (groups.has(key) ? { title: t.title, group: groups.get(key)!, count: t.count } : t))
      .sort((a, b) => a.title.localeCompare(b.title))
  }

  /** Put a tag in a group, or with null take it out of its group. Tag names match without regard to case. */
  setTagGroup(tag: string, group: string | null): void {
    if (group === null) this.db.prepare('delete from tag_groups where tag = ?').run(tag)
    else this.db.prepare('insert into tag_groups (tag, grp) values (?, ?) on conflict(tag) do update set grp = excluded.grp').run(tag, group)
  }

  renameGroup(from: string, to: string): void {
    this.db.prepare('update tag_groups set grp = ? where grp = ?').run(to, from)
  }

  // ---- posters ----

  posters(): Map<string, string> {
    const rows = this.db.prepare('select imdb, url from posters').all() as unknown as { imdb: string; url: string }[]
    return new Map(rows.map((r) => [r.imdb.toLowerCase(), r.url]))
  }

  setPoster(imdb: string, url: string): void {
    this.db.prepare('insert into posters (imdb, url) values (?, ?) on conflict(imdb) do update set url = excluded.url').run(imdb.toLowerCase(), url)
  }

  // ---- suggestions ----

  addSuggestions(items: Omit<Suggestion, 'id' | 'state' | 'createdAt'>[]): Suggestion[] {
    const insert = this.db.prepare('insert into suggestions (id, doc, state, created_at) values (?, ?, ?, ?)')
    const t = this.now()
    return items.map((item, i) => {
      const id = `s-${randomUUID()}`
      insert.run(id, JSON.stringify(item), 'new', t + i)
      return { ...item, id, state: 'new' as const, createdAt: t + i }
    })
  }

  suggestions(state?: SuggestionState): Suggestion[] {
    const rows = (state
      ? this.db.prepare('select * from suggestions where state = ? order by created_at desc').all(state)
      : this.db.prepare('select * from suggestions order by created_at desc').all()) as unknown as SuggestionRow[]
    return rows.map(toSuggestion)
  }

  suggestion(id: string): Suggestion | null {
    const row = this.db.prepare('select * from suggestions where id = ?').get(id) as unknown as SuggestionRow | undefined
    return row ? toSuggestion(row) : null
  }

  setSuggestionState(id: string, state: SuggestionState): void {
    this.db.prepare('update suggestions set state = ? where id = ?').run(state, id)
  }

  // ---- internals ----

  private row(id: string): TitleRow | undefined {
    return this.db.prepare('select * from titles where id = ?').get(id) as unknown as TitleRow | undefined
  }

  private doc(id: string): TitleDoc {
    const row = this.row(id)
    if (!row) throw new NotFoundError(`no such title: ${id}`)
    return JSON.parse(row.doc) as TitleDoc
  }

  private save(id: string, doc: TitleDoc): void {
    this.db.prepare('update titles set doc = ?, updated_at = ? where id = ?').run(JSON.stringify(doc), this.now(), id)
  }

  private touch(id: string): void {
    this.db.prepare('update titles set updated_at = ? where id = ?').run(this.now(), id)
  }

  private getTitleOrThrow(id: string): Title {
    const detail = this.getTitle(id)
    if (!detail) throw new NotFoundError(`no such title: ${id}`)
    const { propBlockId: _b, notes: _n, ...title } = detail
    return title
  }

  private allNotes(): Map<string, string[]> {
    const out = new Map<string, string[]>()
    for (const n of this.db.prepare('select * from notes order by created_at, rowid').all() as unknown as NoteRow[]) {
      out.set(n.title_id, [...(out.get(n.title_id) ?? []), n.text])
    }
    return out
  }

  private toTitle(row: TitleRow, notes: string[]): Title {
    const doc = JSON.parse(row.doc) as TitleDoc
    const p = doc.props
    const year = int(p.year)
    const title: Title = {
      pageId: row.id,
      pageTitle: year ? `${doc.name} (${year})` : doc.name,
      name: doc.name,
      type: doc.type,
      status: normalizeStatus(p.status),
      tags: doc.tags,
      notesText: notes.join('\n'),
      updatedAt: Number(row.updated_at),
      createdAt: Number(row.created_at),
    }
    const rating = normalizeRating(p.rating)
    if (rating !== undefined) title.rating = rating
    if (p.rec) title.rec = p.rec
    if (p.finished) title.finished = p.finished
    if (p.progress) title.progress = p.progress
    if (p.imdb) title.imdb = p.imdb
    if (year !== undefined) title.year = year
    const runtime = int(p.runtime)
    if (runtime !== undefined) title.runtime = runtime
    const rt = int(p.rt)
    if (rt !== undefined) title.rt = rt
    if (p.summary) title.summary = p.summary
    for (const key of LIST_FIELDS) {
      const items = list(p[key])
      if (items) (title as unknown as Record<string, string[]>)[key] = items
    }
    return title
  }

  /** The raw page fields of a stored title, for moving it to Grimoire. */
  fieldsOf(id: string): { name: string; type: MediaType; fields: Partial<Record<FieldKey, string>>; tags: string[] } {
    const doc = this.doc(id)
    return { name: doc.name, type: doc.type, fields: { ...doc.props }, tags: [...doc.tags] }
  }
}

function toSuggestion(row: SuggestionRow): Suggestion {
  return { ...(JSON.parse(row.doc) as Omit<Suggestion, 'id' | 'state' | 'createdAt'>), id: row.id, state: row.state, createdAt: Number(row.created_at) }
}

/** Once each, case-insensitively, first spelling kept. */
function dedupe(tags: string[]): string[] {
  const seen = new Set<string>()
  return tags.filter((t) => {
    const k = t.trim().toLowerCase()
    if (!k || seen.has(k)) return false
    seen.add(k)
    return true
  }).map((t) => t.trim())
}
