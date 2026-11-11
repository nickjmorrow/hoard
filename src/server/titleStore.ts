import type { FieldKey, Status, Title } from '../shared/title.ts'

/** A write that only happens if, inside the write queue, the page's live status is one of these. */
export interface SetFieldsOptions { onlyIfStatus?: Status[] }

/** The slice of the library that background work needs. */
export interface TitleStore {
  listTitles(): Promise<Title[]>
  getTitle(pageId: string): Promise<Title | null>
  setFields(pageId: string, fields: Partial<Record<FieldKey, string | null>>, opts?: SetFieldsOptions): Promise<Title>
}
