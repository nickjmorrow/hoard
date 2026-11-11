import { describe, expect, it } from 'vitest'
import { applyPatch, FieldError, writeFields, type FieldTarget } from './applyPatch.ts'

const NOW = new Date('2026-10-20T03:00:00Z') // still Oct 19 in New York (the test time zone)

function base(): FieldTarget {
  return {
    pageId: 'p', pageTitle: 'Starfall (2021)', name: 'Starfall', type: 'movie', status: 'want', tags: ['Anime'],
    rt: 83, genre: ['Drama'], rec: 'Claude', updatedAt: 0, createdAt: 0,
  }
}

describe('applyPatch', () => {
  it('sets finished to today in the local time zone when status becomes done without one', () => {
    expect(applyPatch(base(), { fields: { status: 'done' } }, NOW)).toMatchObject({ status: 'done', finished: '2026-10-19' })
  })

  it('keeps an explicit finished, including null to clear it', () => {
    const done = { ...base(), status: 'done' as const, finished: '2026-01-01' }
    expect(applyPatch(done, { fields: { status: 'want', finished: null } }, NOW).finished).toBeUndefined()
    expect(applyPatch(base(), { fields: { status: 'done', finished: '2026-02-02' } }, NOW).finished).toBe('2026-02-02')
  })

  it('parses numbers and genre, removes on null or empty, replaces tags', () => {
    const got = applyPatch(base(), {
      fields: { rating: '4', runtime: '155', genre: 'Action, Adventure', rt: null, rec: '' },
      tags: ['Meta'],
    }, NOW)
    expect(got).toMatchObject({ rating: 4, runtime: 155, genre: ['Action', 'Adventure'], tags: ['Meta'] })
    expect(got).not.toHaveProperty('rt')
    expect(got).not.toHaveProperty('rec')
  })

  it('returns a copy and leaves the original alone', () => {
    const t = base()
    applyPatch(t, { fields: { status: 'doing' }, tags: [] }, NOW)
    expect(t).toMatchObject({ status: 'want', tags: ['Anime'] })
  })

  it('skips invalid values, or throws FieldError when strict', () => {
    expect(applyPatch(base(), { fields: { rating: '6', status: 'later' } }, NOW)).toMatchObject({ status: 'want' })
    expect(applyPatch(base(), { fields: { rating: '6' } }, NOW)).not.toHaveProperty('rating')
    expect(() => writeFields(base(), { rating: '4.5' }, true)).toThrow(FieldError)
    expect(() => writeFields(base(), { type: 'podcast' }, true)).toThrow(FieldError)
  })
})
