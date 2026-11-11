// An in-memory stand-in for the library, shared by the route tests.

import { LIST_FIELDS, type FieldKey, type MediaType, type Title } from '../shared/title.ts'
import type { LibraryPort } from './app.ts'
import type { TagInfo, TitleDetail } from './model.ts'

const NUMBER_FIELDS = new Set<FieldKey>(['rating', 'year', 'runtime', 'rt'])

/** An in-memory stand-in for the library that records every write. */
export class FakeLibrary implements LibraryPort {
  titles = new Map<string, TitleDetail>()
  tags: TagInfo[] = []
  writes: string[] = []
  failWith: Error | null = null
  private nextId = 1

  add(t: Partial<TitleDetail> & { pageTitle: string; type: MediaType }): TitleDetail {
    const id = `p${this.nextId++}`
    const detail: TitleDetail = {
      pageId: id, name: t.pageTitle.replace(/ \(\d{4}\)$/, ''), status: 'want', tags: [], notesText: '',
      updatedAt: 1, createdAt: 1, propBlockId: `${id}-props`, notes: [], ...t,
    }
    this.titles.set(id, detail)
    return detail
  }

  private plain(id: string): Title {
    const { propBlockId: _b, notes: _n, ...title } = this.titles.get(id)!
    return title
  }

  private check(): void {
    if (this.failWith) throw this.failWith
  }

  async listTitles(): Promise<Title[]> {
    this.check()
    return [...this.titles.keys()].map((id) => this.plain(id))
  }
  async getTitle(pageId: string): Promise<TitleDetail | null> {
    this.check()
    return this.titles.get(pageId) ?? null
  }
  async listTags(): Promise<TagInfo[]> {
    this.check()
    return this.tags
  }
  async setFields(pageId: string, fields: Partial<Record<FieldKey, string | null>>): Promise<Title> {
    this.check()
    this.writes.push(`setFields ${pageId} ${JSON.stringify(fields)}`)
    const t = this.titles.get(pageId) as unknown as Record<string, unknown>
    for (const [key, value] of Object.entries(fields)) {
      if (value === null) delete t[key]
      else t[key] = NUMBER_FIELDS.has(key as FieldKey) ? Number(value)
        : LIST_FIELDS.includes(key as FieldKey) ? value.split(',').map((v) => v.trim()) : value
    }
    return this.plain(pageId)
  }
  async setTags(pageId: string, tags: string[]): Promise<Title> {
    this.check()
    this.writes.push(`setTags ${pageId} ${JSON.stringify(tags)}`)
    this.titles.get(pageId)!.tags = tags
    return this.plain(pageId)
  }
  async removeFromHoard(pageId: string): Promise<void> {
    this.writes.push(`removeFromHoard ${pageId}`)
    this.titles.delete(pageId)
  }
  async addNote(pageId: string, text: string): Promise<{ id: string }> {
    this.writes.push(`addNote ${pageId} ${text}`)
    return { id: 'b1' }
  }
  async editNote(blockId: string, text: string): Promise<void> {
    this.writes.push(`editNote ${blockId} ${text}`)
  }
  async createTitle(input: { name: string; year?: number; type: MediaType; fields: Partial<Record<FieldKey, string>>; tags: string[] }): Promise<Title> {
    this.check()
    const pageTitle = input.year ? `${input.name} (${input.year})` : input.name
    this.writes.push(`createTitle ${JSON.stringify(input)}`)
    const t = this.add({ pageTitle, type: input.type, tags: input.tags, ...(input.year ? { year: input.year } : {}) })
    await this.setFields(t.pageId, input.fields)
    this.writes.pop()
    return this.plain(t.pageId)
  }
  async setTagGroup(tag: string, group: string | null): Promise<void> {
    this.writes.push(`setTagGroup ${tag} ${group}`)
  }
  async renameGroup(from: string, to: string): Promise<void> {
    this.writes.push(`renameGroup ${from} ${to}`)
  }
}

