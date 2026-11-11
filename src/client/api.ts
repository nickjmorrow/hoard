// One typed function per /api route. A non-2xx answer throws an Error carrying the server's message.

import type { MediaType, Title } from '../shared/title.ts'
import type {
  CreateTitleBody, CreateTitleResponse, LibraryResponse, LookupResult, PatchTitleBody, TitleDetailResponse,
} from './apiTypes.ts'
import { SERVER_NAME } from './serverName.ts'

type Fetch = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>

// The fake API is a separate chunk, loaded only when VITE_FAKE_API=1.
const http: Fetch = import.meta.env.VITE_FAKE_API === '1'
  ? async (input, init) => (await import('./fakeApi.ts')).fakeFetch(input, init)
  : (input, init) => fetch(input, init)

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  let res: Response
  try {
    res = await http(path, {
      method,
      ...(body === undefined ? {} : { body: JSON.stringify(body), headers: { 'content-type': 'application/json' } }),
    })
  } catch {
    throw new Error(`Can’t reach ${SERVER_NAME}`)
  }
  const data: unknown = await res.json().catch(() => undefined)
  if (!res.ok) {
    const msg = data && typeof data === 'object' && 'error' in data && typeof data.error === 'string' ? data.error : ''
    throw new Error(msg || `Request failed (${res.status})`)
  }
  return data as T
}

const enc = encodeURIComponent

export const api = {
  library: () => request<LibraryResponse>('GET', '/api/library'),
  title: (pageId: string) => request<TitleDetailResponse>('GET', `/api/titles/${enc(pageId)}`),
  patchTitle: (pageId: string, body: PatchTitleBody) => request<Title>('PATCH', `/api/titles/${enc(pageId)}`, body),
  createTitle: (body: CreateTitleBody) => request<CreateTitleResponse>('POST', '/api/titles', body),
  addNote: (pageId: string, text: string) =>
    request<{ id: string; text: string }>('POST', `/api/titles/${enc(pageId)}/notes`, { text }),
  editNote: (blockId: string, text: string) => request<unknown>('PUT', `/api/notes/${enc(blockId)}`, { text }),
  removeFromHoard: (pageId: string) => request<unknown>('DELETE', `/api/titles/${enc(pageId)}/hoard`),
  match: (pageId: string, id: string) => request<Title>('POST', `/api/titles/${enc(pageId)}/match`, { id }),
  lookup: (type: MediaType, q: string) =>
    request<LookupResult[]>('GET', `/api/lookup?type=${enc(type)}&q=${enc(q)}`),
  setTagGroup: (tag: string, group: string | null) =>
    request<unknown>('PUT', `/api/tags/${enc(tag)}/group`, { group }),
  renameGroup: (from: string, to: string) => request<unknown>('POST', '/api/groups/rename', { from, to }),
}
