import { describe, expect, it, vi } from 'vitest'
import type { Title } from '../shared/title.ts'
import { AutoTagger, buildTagPrompt, genreGroups, MAX_PICKS, parseTagReply, type AutoTagLibrary } from './autoTag.ts'
import type { TagInfo } from './model.ts'

function title(t: Partial<Title> & { name: string }): Title {
  return { pageId: t.name, pageTitle: t.name, type: 'movie', status: 'want', tags: [], notesText: '', updatedAt: 0, createdAt: 0, ...t }
}

const TAGS: TagInfo[] = [
  { title: 'Village Horror', group: 'Horror', count: 3 },
  { title: 'Haunted House', group: 'Horror', count: 2 },
  { title: 'Time Travel', group: 'Sci-Fi', count: 1 },
  { title: 'Watch with Priya', group: 'With', count: 4 },
  { title: 'Background', group: 'Vibe', count: 2 },
  { title: 'Rewatch', count: 1 },
]

function fakeLibrary(titles: Title[]): AutoTagLibrary & { titles: Map<string, Title> } {
  const map = new Map(titles.map((t) => [t.pageId, t]))
  return {
    titles: map,
    getTitle: async (id) => map.get(id) ?? null,
    listTags: async () => TAGS,
    setTags: async (id, tags) => { const t = { ...map.get(id)!, tags }; map.set(id, t); return t },
  }
}

describe('genreGroups', () => {
  it('keeps only the genre groups, never personal groups or ungrouped tags', () => {
    expect(genreGroups(TAGS)).toEqual([['Horror', ['Village Horror', 'Haunted House']], ['Sci-Fi', ['Time Travel']]])
  })
})

describe('buildTagPrompt', () => {
  it('describes the title and lists the tags by group', () => {
    const prompt = buildTagPrompt(title({ name: 'Harvest Rites', year: 2019, genre: ['Drama', 'Horror'], summary: 'A festival.' }), genreGroups(TAGS))
    expect(prompt).toContain('Harvest Rites (2019), a movie')
    expect(prompt).toContain('Genre: Drama, Horror')
    expect(prompt).toContain('Summary: A festival.')
    expect(prompt).toContain('- Horror: Village Horror; Haunted House')
    expect(prompt).not.toContain('Watch with Priya')
  })
})

describe('parseTagReply', () => {
  const allowed = ['Village Horror', 'Haunted House', 'Time Travel']

  it('keeps only tags that exist, spelled as the library has them, without repeats', () => {
    expect(parseTagReply('```json\n["folk horror", "Made Up", "Village Horror", " Haunted House "]\n```', allowed)).toEqual(['Village Horror', 'Haunted House'])
  })

  it(`takes at most ${MAX_PICKS}`, () => {
    const many = ['A', 'B', 'C', 'D', 'E']
    expect(parseTagReply(JSON.stringify(many), many)).toHaveLength(MAX_PICKS)
  })

  it('accepts an empty list and refuses a reply with no list', () => {
    expect(parseTagReply('[]', allowed)).toEqual([])
    expect(() => parseTagReply('Sorry.', allowed)).toThrow()
  })
})

describe('AutoTagger', () => {
  it('adds Claude\'s picks to the tags the title came with', async () => {
    const lib = fakeLibrary([title({ name: 'Harvest Rites', tags: ['Watch with Priya'] })])
    await new AutoTagger(lib, { pick: async () => '["Village Horror", "Haunted House"]' }).tagNow('Harvest Rites')
    expect(lib.titles.get('Harvest Rites')!.tags).toEqual(['Watch with Priya', 'Village Horror', 'Haunted House'])
  })

  it('keeps tags changed while Claude was thinking, and never repeats one', async () => {
    const lib = fakeLibrary([title({ name: 'Harvest Rites' })])
    const pick = async () => {
      lib.titles.set('Harvest Rites', { ...lib.titles.get('Harvest Rites')!, tags: ['Village Horror', 'Rewatch'] })
      return '["Village Horror", "Haunted House"]'
    }
    await new AutoTagger(lib, { pick }).tagNow('Harvest Rites')
    expect(lib.titles.get('Harvest Rites')!.tags).toEqual(['Village Horror', 'Rewatch', 'Haunted House'])
  })

  it('leaves games alone', async () => {
    const lib = fakeLibrary([title({ name: 'Ember Keep', type: 'game' })])
    const pick = vi.fn(async () => '["Village Horror"]')
    await new AutoTagger(lib, { pick }).tagNow('Ember Keep')
    expect(pick).not.toHaveBeenCalled()
  })

  it('logs a failure and tries once more later', async () => {
    const lib = fakeLibrary([title({ name: 'Harvest Rites' })])
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {})
    let calls = 0
    const pick = async () => { calls++; if (calls < 3) throw new Error('Claude is busy'); return '["Village Horror"]' }
    await new AutoTagger(lib, { pick }, 1).tagNow('Harvest Rites')
    await vi.waitFor(() => expect(calls).toBe(2))
    await new Promise((r) => setTimeout(r, 20))
    expect(calls).toBe(2)
    expect(lib.titles.get('Harvest Rites')!.tags).toEqual([])
    expect(errors).toHaveBeenCalledTimes(2)
    errors.mockRestore()
  })
})
