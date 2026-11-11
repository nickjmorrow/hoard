import { Grimoire } from './grimoire.ts'
import { grim, GrimError } from './grim.ts'
import { makeTestGraph } from './testGraph.ts'

let graph: Awaited<ReturnType<typeof makeTestGraph>>
const g = new Grimoire()

beforeAll(async () => { graph = await makeTestGraph() })
afterAll(() => graph.cleanup())

describe('listTitles', () => {
  test('returns exactly the pages tagged [[media]] with a type', async () => {
    const titles = await g.listTitles()
    expect(titles.map((t) => t.pageTitle).sort()).toEqual(['Echo (2026)', 'Gloamwood', 'Starfall (2021)'])
  })

  test('reads properties, tags, year and notes', async () => {
    const starfall = (await g.listTitles()).find((t) => t.pageTitle === 'Starfall (2021)')!
    expect(starfall).toMatchObject({
      name: 'Starfall', type: 'movie', status: 'want', tags: ['Watch with Priya'], year: 2021,
      rec: 'Claude', imdb: 'tt1000419', runtime: 155, genre: ['Action', 'Adventure', 'Drama'], rt: 83,
    })
    expect(starfall.rating).toBeUndefined()
    expect(starfall.notesText).toContain('The meteor scene on the big screen')
    expect(starfall.updatedAt).toBeGreaterThan(0)
    expect(starfall.createdAt).toBeGreaterThan(0)
  })

  test('accepts tags after type and legacy keys and values', async () => {
    const titles = await g.listTitles()
    expect(titles.find((t) => t.pageTitle === 'Echo (2026)')).toMatchObject({ type: 'movie', year: 2026, tags: [] })
    const medium = titles.find((t) => t.pageTitle === 'Gloamwood')!
    expect(medium).toMatchObject({ name: 'Gloamwood', type: 'game', status: 'want' })
    expect(medium.rating).toBeUndefined()
    expect(medium.year).toBeUndefined()
  })
})

describe('skippedPages', () => {
  test('names the [[media]] pages that aren’t readable as titles, leaving books to their own app', async () => {
    expect(await g.skippedPages()).toEqual(['Stray Page'])
  })
})

describe('getTitle', () => {
  test('returns the property block id and the notes', async () => {
    const starfall = (await g.listTitles()).find((t) => t.pageTitle === 'Starfall (2021)')!
    const detail = (await g.getTitle(starfall.pageId))!
    expect(detail.pageTitle).toBe('Starfall (2021)')
    expect(detail.propBlockId).toMatch(/\S/)
    expect(detail.notes).toEqual([{ id: expect.any(String), text: expect.stringContaining('The meteor scene on the big screen') }])
  })

  test('is null for a missing page and for a page that is not a title', async () => {
    expect(await g.getTitle('no-such-page')).toBeNull()
    const [row] = (await grim(['query', "select id from pages where title = 'Watchlist'"])) as { id: string }[]
    expect(await g.getTitle(row!.id)).toBeNull()
  })
})

describe('listTags', () => {
  test('lists tags used by titles and tag pages with a group, without media', async () => {
    const tags = await g.listTags()
    expect(tags).toContainEqual({ title: 'Cozy Mystery', group: 'Vibe', count: 0 })
    expect(tags).toContainEqual({ title: 'Watch with Priya', count: 1 })
    expect(tags.map((t) => t.title.toLowerCase())).not.toContain('media')
  })
})

describe('grim', () => {
  test('passes text starting with "-" as text, not as an option', async () => {
    for (const title of ['-ish (2020)', '--draft', '-h']) await grim(['create-page', title], { author: 'claude' })
    const rows = (await grim(['query', "select title from pages where title like '-%' order by title"])) as { title: string }[]
    expect(rows.map((r) => r.title)).toEqual(['--draft', '-h', '-ish (2020)'])
  })

  test('passes an option value starting with "-" to the option', async () => {
    await grim(['create-page', '-dashed (2019)'], { author: 'claude' })
    const { blockIds } = (await grim(['insert', '--page', '-dashed (2019)', 'first note'], { author: 'claude' })) as { blockIds: string[] }
    await grim(['insert', '--after', blockIds[0]!, '--draft'], { author: 'claude' })
    const rows = (await grim(['query', `
      select b.text from blocks b join pages p on p.id = b.page_id
      where p.title = '-dashed (2019)' order by b.order_key`])) as { text: string }[]
    expect(rows.map((r) => r.text)).toEqual(['first note', '--draft'])
  })

  test('a failing command throws GrimError with grim\'s message', async () => {
    await expect(grim(['query', 'select bogus'])).rejects.toThrow(GrimError)
    await expect(grim(['query', 'select bogus'])).rejects.toThrow(/no such column/)
  })
})
