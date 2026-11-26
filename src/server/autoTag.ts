// Tags each new movie or show with its genre tags. Claude picks from the tags already in the genre
// groups (never a new tag, never one from personal groups like With or Vibe) and the picks are added to
// whatever tags the title came with; nothing is removed.

import type { Title } from '../shared/title.ts'
import type { TagInfo } from './model.ts'
import { runClaude, viewerName } from './suggest.ts'

/** The tag groups auto-tagging picks from. A new genre group only needs adding here. */
export const GENRE_GROUPS = ['Horror', 'Sci-Fi', 'Fantasy', 'Action', 'Crime & Thriller', 'Comedy', 'Drama', 'Family', 'Unscripted']

export const MAX_PICKS = 4

/** If Claude can't answer, one more try this much later. */
export const RETRY_AFTER_MS = 10 * 60_000

/** Turns a prompt into Claude's reply text. The real one runs Claude; tests pass a fake. */
export interface TagPicker {
  pick(prompt: string): Promise<string>
}

export interface AutoTagLibrary {
  getTitle(pageId: string): Promise<Title | null>
  listTags(): Promise<TagInfo[]>
  setTags(pageId: string, tags: string[]): Promise<Title>
}

/** The genre groups' tags, in GENRE_GROUPS order; groups with no tags are left out. */
export function genreGroups(tags: TagInfo[]): [string, string[]][] {
  return GENRE_GROUPS
    .map((group): [string, string[]] => [group, tags.filter((t) => t.group === group).map((t) => t.title)])
    .filter(([, names]) => names.length > 0)
}

export function buildTagPrompt(t: Title, groups: [string, string[]][], who = viewerName()): string {
  const about = [
    `${t.name}${t.year ? ` (${t.year})` : ''}, a ${t.type === 'show' ? 'TV show' : 'movie'}`,
    t.genre?.length ? `Genre: ${t.genre.join(', ')}` : '',
    t.director?.length ? `Directed by ${t.director.join(', ')}` : '',
    t.summary ? `Summary: ${t.summary}` : '',
  ].filter(Boolean)
  return [
    `${who === 'someone' ? 'Someone' : who} tags the movies and shows in their library by subgenre. Pick the tags that fit this title:`,
    ...about,
    '',
    'Their tags, by genre:',
    ...groups.map(([group, names]) => `- ${group}: ${names.join('; ')}`),
    '',
    `Pick 1 to ${MAX_PICKS} tags from that list that clearly describe it, most important first. Use the tag names exactly.`,
    'If you don\'t know this title, judge from what\'s given. If none fit, reply with an empty list.',
    'Reply with only a JSON array of tag names, no prose and no code fence: ["Tag", "Tag"]',
  ].join('\n')
}

/** The allowed tags Claude named, spelled as the library's tags are, without repeats, at most MAX_PICKS. */
export function parseTagReply(text: string, allowed: string[]): string[] {
  const start = text.indexOf('[')
  const end = text.lastIndexOf(']')
  if (start === -1 || end <= start) throw new Error('Claude didn\'t return a list of tags')
  const raw: unknown = JSON.parse(text.slice(start, end + 1))
  if (!Array.isArray(raw)) throw new Error('Claude didn\'t return a list of tags')
  const byKey = new Map(allowed.map((name) => [name.toLowerCase(), name]))
  const picks: string[] = []
  for (const item of raw) {
    const name = typeof item === 'string' ? byKey.get(item.trim().toLowerCase()) : undefined
    if (name && !picks.includes(name)) picks.push(name)
  }
  return picks.slice(0, MAX_PICKS)
}

export class AutoTagger {
  private library: AutoTagLibrary
  private picker: TagPicker
  private retryAfterMs: number

  constructor(library: AutoTagLibrary, picker: TagPicker, retryAfterMs = RETRY_AFTER_MS) {
    this.library = library
    this.picker = picker
    this.retryAfterMs = retryAfterMs
  }

  /** Tags one new title. Never rejects: a failure is logged and tried once more later. */
  async tagNow(pageId: string, isRetry = false): Promise<void> {
    try {
      await this.tag(pageId)
    } catch (e) {
      console.error(`autotag: ${pageId}: ${e instanceof Error ? e.message : String(e)}`)
      if (!isRetry) setTimeout(() => void this.tagNow(pageId, true), this.retryAfterMs).unref()
    }
  }

  private async tag(pageId: string): Promise<void> {
    const t = await this.library.getTitle(pageId)
    if (!t || t.type === 'game') return
    const groups = genreGroups(await this.library.listTags())
    if (groups.length === 0) return
    const picks = parseTagReply(await this.picker.pick(buildTagPrompt(t, groups)), groups.flatMap(([, names]) => names))
    // Claude takes a while: re-read so tags changed meanwhile are kept.
    const fresh = await this.library.getTitle(pageId)
    if (!fresh) return
    const have = new Set(fresh.tags.map((x) => x.toLowerCase()))
    const added = picks.filter((x) => !have.has(x.toLowerCase()))
    if (added.length > 0) await this.library.setTags(pageId, [...fresh.tags, ...added])
  }
}

/** Claude Sonnet: picking from a list doesn't need the suggestion model. */
export class ClaudeTagPicker implements TagPicker {
  pick(prompt: string): Promise<string> {
    return runClaude(prompt, { model: process.env.HOARD_CLAUDE_TAG_MODEL ?? 'sonnet', timeoutMs: 120_000 })
  }
}
