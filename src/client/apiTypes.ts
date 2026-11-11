// The JSON shapes of the server's /api routes (plan, Task 4), mirrored here
// because the server lives on another branch. Keep in step with src/server/app.ts.

import type { FieldKey, MediaType, Title } from '../shared/title.ts'

export interface TagInfo { title: string; group?: string; count: number }

export interface TitleDetail extends Title { propBlockId: string; notes: { id: string; text: string }[] }

export interface LookupResult { source: 'omdb'; id: string; name: string; year?: number; detail: string }

/** onEdgar: null when Jellyfin can't say (down, or no imdb to ask about). */
export type TitleWithAvail = Title & { onEdgar: boolean | null; /** Jellyfin's item id; only for titles on the server. The Apple apps play with it. */ jellyfinId?: string }

export interface LibraryResponse { titles: TitleWithAvail[]; tags: TagInfo[]; jellyfinUp: boolean }

export type TitleDetailResponse = TitleDetail & { onEdgar: boolean | null; jellyfinId?: string }

/** PATCH /api/titles/:pageId. A null field removes that property line. */
export interface PatchTitleBody { fields?: Partial<Record<FieldKey, string | null>>; tags?: string[] }

/** POST /api/titles */
export interface CreateTitleBody {
  type: MediaType
  name: string
  year?: number
  imdb?: string
  fields?: Partial<Record<FieldKey, string>>
  tags?: string[]
}
export interface CreateTitleResponse { title: Title; existed: boolean }

/** POST /api/titles/:pageId/notes and PUT /api/notes/:blockId */
export interface NoteBody { text: string }
/** POST /api/titles/:pageId/match */
export interface MatchBody { id: string }
/** PUT /api/tags/:tag/group */
export interface TagGroupBody { group: string | null }
/** POST /api/groups/rename */
export interface RenameGroupBody { from: string; to: string }

/** Every non-2xx answer. */
export interface ApiError { error: string }
