import { beforeEach, describe, expect, it } from 'vitest'
import { fakeConfig, fakeFetch, resetFakeApi } from './fakeApi.ts'
import { todayLocal } from './dates.ts'
import type { CreateTitleResponse, LibraryResponse } from './apiTypes.ts'
import type { Title } from '../shared/title.ts'

async function call<T>(method: string, path: string, body?: unknown): Promise<{ status: number; body: T }> {
  const res = await fakeFetch(path, { method, ...(body === undefined ? {} : { body: JSON.stringify(body) }) })
  return { status: res.status, body: (await res.json()) as T }
}

describe('fakeApi', () => {
  beforeEach(() => {
    fakeConfig.latencyMs = 0
    fakeConfig.jellyfinUp = true
    resetFakeApi()
  })

  it('serves the library with tags and availability', async () => {
    const { body } = await call<LibraryResponse>('GET', '/api/library')
    expect(body.jellyfinUp).toBe(true)
    expect(body.titles.find((t) => t.name === 'Starfall')?.onEdgar).toBe(true)
    expect(body.tags.find((t) => t.title === 'Anime')).toMatchObject({ group: 'Style', count: 4 })
  })

  it('gives onEdgar null for every title when Jellyfin is down', async () => {
    fakeConfig.jellyfinUp = false
    const { body } = await call<LibraryResponse>('GET', '/api/library')
    expect(body.jellyfinUp).toBe(false)
    expect(body.titles.every((t) => t.onEdgar === null)).toBe(true)
  })

  it('sets finished to today in the local time zone when status becomes done without one', async () => {
    const { body } = await call<Title>('PATCH', '/api/titles/page-1', { fields: { status: 'done' } })
    expect(body).toMatchObject({ status: 'done', finished: todayLocal() })
  })

  it('finds an existing title by imdb, then exact page title', async () => {
    const byImdb = await call<CreateTitleResponse>('POST', '/api/titles', { type: 'movie', name: 'Whatever', imdb: 'tt1000419' })
    expect(byImdb.body).toMatchObject({ existed: true, title: { name: 'Starfall' } })
    const byPage = await call<CreateTitleResponse>('POST', '/api/titles', { type: 'show', name: 'The Quiet Harbor' })
    expect(byPage.body.existed).toBe(true)
    const fresh = await call<CreateTitleResponse>('POST', '/api/titles', { type: 'movie', name: 'Starfall', year: 1984 })
    expect(fresh.body).toMatchObject({ existed: false, title: { pageTitle: 'Starfall (1984)' } })
  })

  it('answers 404 with an error for an unknown page', async () => {
    const res = await call<{ error: string }>('GET', '/api/titles/nope')
    expect(res.status).toBe(404)
    expect(res.body.error).toMatch(/nope/)
  })
})
