// What the library hands out, shared by Hoard's store and the Grimoire reader the one-time import uses.

import type { Title } from '../shared/title.ts'

/** A title or note that doesn't exist. The API answers 404. */
export class NotFoundError extends Error {}
/** A note edit aimed at something that isn't a note. The API answers 400. */
export class NotANoteError extends Error {}

export interface TitleDetail extends Title {
  propBlockId: string
  notes: { id: string; text: string }[]
}

export interface TagInfo {
  title: string
  group?: string
  count: number
}
