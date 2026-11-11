// What the API, the enricher and the auto-watched loop work on: Hoard's own store, behind the
// same async interface they always used. A title keeps one id for life; an old `w-` id from
// before everything lived here still finds the title it became.

import type { FieldKey, MediaType, Title } from '../shared/title.ts'
import type { LibraryPort } from './app.ts'
import { NotFoundError, type TagInfo, type TitleDetail } from './model.ts'
import type { Store } from './store.ts'
import type { SetFieldsOptions, TitleStore } from './titleStore.ts'

export class Library implements LibraryPort, TitleStore {
  private store: Store

  constructor(store: Store) {
    this.store = store
  }

  /** Every title, each with its poster when known. */
  async listTitles(): Promise<Title[]> {
    const posters = this.store.posters()
    return this.store.listTitles().map((t) => {
      const url = t.imdb ? posters.get(t.imdb.toLowerCase()) : undefined
      return url ? { ...t, poster: url } : t
    })
  }

  async getTitle(id: string): Promise<TitleDetail | null> {
    const detail = this.store.getTitle(this.store.resolve(id))
    if (!detail?.imdb) return detail
    const url = this.store.posters().get(detail.imdb.toLowerCase())
    return url ? { ...detail, poster: url } : detail
  }

  async listTags(): Promise<TagInfo[]> {
    return this.store.listTags()
  }

  async setFields(id: string, fields: Partial<Record<FieldKey, string | null>>, opts: SetFieldsOptions = {}): Promise<Title> {
    const pageId = this.store.resolve(id)
    if (opts.onlyIfStatus) {
      const current = this.store.getTitle(pageId)
      if (!current) throw new NotFoundError(`no such title: ${pageId}`)
      if (!opts.onlyIfStatus.includes(current.status)) return plain(current)
    }
    return this.store.setFields(pageId, fields)
  }

  async setTags(id: string, tags: string[]): Promise<Title> {
    return this.store.setTags(this.store.resolve(id), tags)
  }

  async removeFromHoard(id: string): Promise<void> {
    this.store.deleteTitle(this.store.resolve(id))
  }

  async addNote(id: string, text: string): Promise<{ id: string }> {
    return this.store.addNote(this.store.resolve(id), text)
  }

  async editNote(blockId: string, text: string): Promise<void> {
    this.store.editNote(blockId, text)
  }

  async createTitle(input: {
    name: string
    year?: number
    type: MediaType
    fields: Partial<Record<FieldKey, string>>
    tags: string[]
  }): Promise<Title> {
    return this.store.createTitle(input)
  }

  async setTagGroup(tag: string, group: string | null): Promise<void> {
    this.store.setTagGroup(tag, group)
  }

  async renameGroup(from: string, to: string): Promise<void> {
    this.store.renameGroup(from, to)
  }
}

function plain({ propBlockId: _b, notes: _n, ...title }: TitleDetail): Title {
  return title
}
