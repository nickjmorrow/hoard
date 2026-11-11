// Reads Hoard's old title pages from Grimoire, for the one-time import into Hoard's own store
// (scripts/onehome/). Read-only: Hoard writes nothing to Grimoire. The page format is
// docs/title-page-format.md.

import { MEDIA_TAG, MEDIA_TYPES, type MediaType, type Title } from '../shared/title.ts'
import { normalizeRating, normalizeStatus, parseProps, parseTagLine, splitPageTitle } from '../shared/titleFormat.ts'
import { grim } from './grim.ts'
import type { TagInfo, TitleDetail } from './model.ts'

/** A page whose first block is a title's property block. grim prints every SQL value as a string. */
interface TitleRow {
  id: string
  title: string
  created_at: string
  updated_at: string
  prop_block: string
  prop_text: string
  notes_text: string | null
}

/** A SQL string literal. grim query takes no parameters, so values are quoted here. */
function sql(value: string): string {
  return `'${value.replaceAll("'", "''")}'`
}

// Pages whose page-level `tags` property (grim derives it from the first top-level block) links to
// the page `media`, with that first block's id and text.
const TITLE_PAGES = `
  with first_blocks as (
    select p.id, p.title, p.created_at, p.updated_at,
      (select b.id from blocks b where b.page_id = p.id and b.parent_id is null
        order by b.order_key limit 1) as prop_block
    from pages p
    where exists (
      select 1 from block_props bp join properties pr on pr.id = bp.property_id
      where bp.owner_kind = 'page' and bp.owner_id = p.id and pr.key = 'tags'
        and bp.value in (select id from pages where title_lower = ${sql(MEDIA_TAG)}))
  )
  select f.id, f.title, f.created_at, f.updated_at, f.prop_block, pb.text as prop_text
  from first_blocks f join blocks pb on pb.id = f.prop_block`

const LIST_TITLES = `
  with t as (${TITLE_PAGES})
  select t.*,
    (select group_concat(text, char(10)) from (
      select b.text from blocks b where b.page_id = t.id and b.id <> t.prop_block
      order by b.order_key)) as notes_text
  from t`

function int(raw?: string): number | undefined {
  const n = Number.parseInt(raw ?? '', 10)
  return Number.isNaN(n) ? undefined : n
}

function text(raw?: string): string | undefined {
  return raw ? raw : undefined
}

/** Whether a first block's properties make its page a title: [[media]] in the tags line and a known type. */
function isTitleBlock(props: Map<string, string>): boolean {
  const type = props.get('type')?.toLowerCase() as MediaType | undefined
  return parseTagLine(props.get('tags') ?? '').some((t) => t.toLowerCase() === MEDIA_TAG) && !!type && MEDIA_TYPES.includes(type)
}

/** A Title from a page row, or null when the first block isn't a title's (no [[media]] in its tags line, or no known type). */
function toTitle(row: TitleRow): Title | null {
  const props = parseProps(row.prop_text)
  if (!isTitleBlock(props)) return null
  const tagNames = parseTagLine(props.get('tags') ?? '')
  const type = props.get('type')!.toLowerCase() as MediaType

  const seen = new Set([MEDIA_TAG])
  const tags = tagNames.filter((t) => !seen.has(t.toLowerCase()) && seen.add(t.toLowerCase()))
  const { name, year } = splitPageTitle(row.title)
  const list = (key: string) => {
    const items = props.get(key)?.split(',').map((g) => g.trim()).filter(Boolean)
    return items?.length ? items : undefined
  }
  return {
    pageId: row.id,
    pageTitle: row.title,
    name,
    type,
    status: normalizeStatus(props.get('status')),
    tags,
    rating: normalizeRating(props.get('rating')),
    rec: text(props.get('rec')),
    finished: text(props.get('finished')),
    progress: text(props.get('progress')),
    imdb: text(props.get('imdb')),
    year: int(props.get('year')) ?? year,
    runtime: int(props.get('runtime')),
    genre: list('genre'),
    rt: int(props.get('rt')),
    summary: text(props.get('summary')),
    director: list('director'),
    writer: list('writer'),
    cast: list('cast'),
    notesText: row.notes_text ?? '',
    updatedAt: Number(row.updated_at),
    createdAt: Number(row.created_at),
  }
}

export class Grimoire {
  async listTitles(): Promise<Title[]> {
    const rows = (await grim(['query', LIST_TITLES])) as TitleRow[]
    return rows.flatMap((row) => toTitle(row) ?? [])
  }

  /** Titles of pages tagged [[media]] that can't be read as a movie, show or game (books belong to their own app). */
  async skippedPages(): Promise<string[]> {
    const rows = (await grim(['query', TITLE_PAGES])) as TitleRow[]
    return rows
      .filter((row) => toTitle(row) === null && parseProps(row.prop_text).get('type')?.toLowerCase() !== 'book')
      .map((row) => row.title)
      .sort()
  }

  async getTitle(pageId: string): Promise<TitleDetail | null> {
    const [row] = (await grim(['query', `with t as (${TITLE_PAGES}) select * from t where t.id = ${sql(pageId)}`])) as TitleRow[]
    if (!row) return null
    // Every block but the property block, depth first in page order: char(1) sorts below any order-key
    // character, so a block's children come before its next sibling.
    const notes = (await grim(['query', `
      with recursive tree(id, text, path) as (
        select id, text, order_key from blocks where page_id = ${sql(pageId)} and parent_id is null
        union all
        select b.id, b.text, tree.path || char(1) || b.order_key from blocks b join tree on b.parent_id = tree.id)
      select id, text from tree where id <> ${sql(row.prop_block)} order by path`])) as { id: string; text: string }[]
    const title = toTitle({ ...row, notes_text: notes.map((n) => n.text).join('\n') })
    return title && { ...title, propBlockId: row.prop_block, notes }
  }

  /** Tags linked from any title's tags line, plus every page with a `group::` line, without media. */
  async listTags(): Promise<TagInfo[]> {
    const counts = new Map<string, { spelling: string; count: number }>()
    for (const title of await this.listTitles()) {
      for (const tag of title.tags) {
        const entry = counts.get(tag.toLowerCase()) ?? { spelling: tag, count: 0 }
        entry.count++
        counts.set(tag.toLowerCase(), entry)
      }
    }
    const pages = (await grim(['query', `
      select p.title_lower, p.title,
        (select b.text from blocks b where b.page_id = p.id and b.parent_id is null
          order by b.order_key limit 1) as first_text
      from pages p
      where p.title_lower in (select value from json_each(${sql(JSON.stringify([...counts.keys()]))}))
        or exists (
          select 1 from block_props bp join properties pr on pr.id = bp.property_id
          where bp.owner_kind = 'page' and bp.owner_id = p.id and pr.key = 'group')`])) as
      { title_lower: string; title: string; first_text: string | null }[]

    const tags = new Map<string, TagInfo>()
    for (const [key, { spelling, count }] of counts) tags.set(key, { title: spelling, count })
    for (const page of pages) {
      if (page.title_lower === MEDIA_TAG) continue
      const group = text(parseProps(page.first_text ?? '').get('group'))
      tags.set(page.title_lower, {
        title: page.title,
        ...(group ? { group } : {}),
        count: counts.get(page.title_lower)?.count ?? 0,
      })
    }
    return [...tags.values()].sort((a, b) => a.title.localeCompare(b.title))
  }
}
