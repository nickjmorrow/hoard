// The shape of a title page, shared by the server, the client and the scripts.
// Books live in Stacks (~/Projects/stacks), which uses the same page shape with `type:: book`;
// Hoard never reads or writes those pages.
// The format itself is documented in docs/title-page-format.md.

export type MediaType = 'movie' | 'show' | 'game'
export type Status = 'want' | 'doing' | 'done' | 'dropped'

export const MEDIA_TYPES: readonly MediaType[] = ['movie', 'show', 'game']
export const STATUSES: readonly Status[] = ['want', 'doing', 'done', 'dropped']

export interface Title {
  pageId: string
  pageTitle: string
  /** pageTitle without a trailing " (Year)". */
  name: string
  type: MediaType
  status: Status
  /** Tag page titles, without [[media]]. */
  tags: string[]
  rating?: number
  rec?: string
  /** YYYY-MM-DD */
  finished?: string
  progress?: string
  imdb?: string
  year?: number
  runtime?: number
  genre?: string[]
  rt?: number
  summary?: string
  director?: string[]
  writer?: string[]
  cast?: string[]
  /** OMDb's poster URL; kept in Hoard's store, never in Grimoire. */
  poster?: string
  /** Text of every block except the property block, joined with newlines. */
  notesText: string
  /** ms since epoch */
  updatedAt: number
  /** ms since epoch */
  createdAt: number
}

/** Property keys Hoard reads and writes on a title page (tags are handled separately). */
export type FieldKey =
  | 'type' | 'status' | 'rating' | 'rec' | 'finished' | 'progress'
  | 'imdb' | 'year' | 'runtime' | 'genre' | 'rt' | 'summary'
  | 'director' | 'writer' | 'cast'

/** What a lookup returns: page fields plus the poster, which never goes on a page. */
export type DetailKey = FieldKey | 'poster'

/** Comma-separated property values that are lists. */
export const LIST_FIELDS: readonly FieldKey[] = ['genre', 'director', 'writer', 'cast']

/** The tag that marks a page as a title. */
export const MEDIA_TAG = 'media'
