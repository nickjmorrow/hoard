import type { DetailKey, MediaType } from '../shared/title.ts'
export interface LookupResult { source: 'omdb'; id: string; name: string; year?: number; detail: string }
export interface Lookup {
  search(type: MediaType, q: string): Promise<LookupResult[]>
  details(type: MediaType, id: string): Promise<Partial<Record<DetailKey, string>>>
}
export interface Availability {
  onEdgar(imdb: string): boolean | null
  isUp(): boolean
  /** Jellyfin's item id for a title on the server; null otherwise. */
  jellyfinId(imdb: string): string | null
}
