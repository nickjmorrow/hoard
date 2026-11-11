// TanStack Query hooks. The whole library is one query; edits update it optimistically
// and roll back with a short message when the save fails.

import { type QueryClient, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from './api.ts'
import type { MediaType, Title } from '../shared/title.ts'
import type { CreateTitleBody, LibraryResponse, PatchTitleBody, TitleDetailResponse } from './apiTypes.ts'
import { applyPatch } from './applyPatch.ts'
import { navigate } from './router.ts'
import { showToast } from './toast.tsx'

export const LIBRARY_KEY = ['library'] as const
const PATCH_KEY = ['patchTitle'] as const
export const titleKey = (pageId: string) => ['title', pageId] as const

/** One title with its notes (GET /api/titles/:pageId). */
export function useTitleDetail(pageId: string) {
  return useQuery({ queryKey: titleKey(pageId), queryFn: () => api.title(pageId) })
}

/** Write a saved Title into both caches, keeping each one's onEdgar (the server's answer is a plain Title). */
function storeTitle(qc: QueryClient, saved: Title): void {
  qc.setQueryData<LibraryResponse>(LIBRARY_KEY, (lib) => lib && {
    ...lib,
    titles: lib.titles.map((t) => (t.pageId === saved.pageId ? { ...saved, onEdgar: t.onEdgar } : t)),
  })
  qc.setQueryData<TitleDetailResponse>(titleKey(saved.pageId), (d) => d && { ...d, ...saved, onEdgar: d.onEdgar })
}

/**
 * A want-list title that was just started has a Grimoire page now, with a new id: rename it in the
 * library, and if its page is open, carry on there (replacing the old address).
 */
function followMove(qc: QueryClient, oldId: string, saved: Title): void {
  qc.setQueryData<LibraryResponse>(LIBRARY_KEY, (lib) => lib && {
    ...lib,
    titles: lib.titles.map((t) => (t.pageId === oldId ? { ...saved, onEdgar: t.onEdgar } : t)),
  })
  if (location.pathname === `/title/${encodeURIComponent(oldId)}`) {
    navigate(`/title/${encodeURIComponent(saved.pageId)}`, { replace: true })
  }
}

/** A title's properties as they were before a patch: undefined means the property wasn't there. */
type Undo = Record<string, unknown>

/** The properties `after` changed from `before`, with their `before` values. */
function changedProps(before: object, after: object): Undo {
  const b = before as Record<string, unknown>
  const a = after as Record<string, unknown>
  const undo: Undo = {}
  for (const key of new Set([...Object.keys(b), ...Object.keys(a)])) {
    if (b[key] !== a[key]) undo[key] = b[key]
  }
  return undo
}

/** `t` with the properties in `undo` put back (removed where they weren't there). */
function restoreProps<T extends object>(t: T, undo: Undo): T {
  const next = { ...t } as Record<string, unknown>
  for (const [key, value] of Object.entries(undo)) {
    if (value === undefined) delete next[key]
    else next[key] = value
  }
  return next as T
}

export function useLibrary() {
  return useQuery({ queryKey: LIBRARY_KEY, queryFn: api.library })
}

export interface PatchVars {
  pageId: string
  body: PatchTitleBody
  /** After a successful save, show this message with an Undo that sends `undo`. */
  toast?: { message: string; undo: PatchTitleBody }
}

export function usePatchTitle() {
  const qc = useQueryClient()
  // Toasts live in the hook-level callbacks: per-call mutate callbacks fire only for the
  // latest mutate and not after unmount, so quick taps would lose a toast.
  const mutation = useMutation({
    mutationKey: PATCH_KEY,
    mutationFn: ({ pageId, body }: PatchVars) => api.patchTitle(pageId, body),
    onMutate: async ({ pageId, body }: PatchVars) => {
      // The title page reads the library's copy when it has one, else the detail: patch both.
      await Promise.all([qc.cancelQueries({ queryKey: LIBRARY_KEY }), qc.cancelQueries({ queryKey: titleKey(pageId) })])
      const lib = qc.getQueryData<LibraryResponse>(LIBRARY_KEY)
      const detail = qc.getQueryData<TitleDetailResponse>(titleKey(pageId))
      // Only what this patch changed, with its old values: a failure must not undo other edits in flight.
      let undoLib: Undo | undefined
      let undoDetail: Undo | undefined
      if (lib) {
        qc.setQueryData<LibraryResponse>(LIBRARY_KEY, {
          ...lib,
          titles: lib.titles.map((t) => {
            if (t.pageId !== pageId) return t
            const next = applyPatch(t, body)
            undoLib = changedProps(t, next)
            return next
          }),
        })
      }
      if (detail) {
        const next = applyPatch(detail, body)
        undoDetail = changedProps(detail, next)
        qc.setQueryData(titleKey(pageId), next)
      }
      return { undoLib, undoDetail }
    },
    onError: (err, { pageId }, ctx) => {
      const undoLib = ctx?.undoLib
      const undoDetail = ctx?.undoDetail
      if (undoLib) {
        qc.setQueryData<LibraryResponse>(LIBRARY_KEY, (lib) => lib && {
          ...lib,
          titles: lib.titles.map((t) => (t.pageId === pageId ? restoreProps(t, undoLib) : t)),
        })
      }
      if (undoDetail) {
        qc.setQueryData<TitleDetailResponse>(titleKey(pageId), (d) => d && restoreProps(d, undoDetail))
      }
      showToast(`Couldn’t save: ${err.message}`)
    },
    onSuccess: (saved, vars) => {
      if (saved.pageId !== vars.pageId) followMove(qc, vars.pageId, saved)
      // With another patch in flight, its optimistic value isn't in `saved` yet: keep the cache.
      else if (qc.isMutating({ mutationKey: PATCH_KEY }) <= 1) storeTitle(qc, saved)
      const toast = vars.toast
      if (toast) {
        showToast(toast.message, { label: 'Undo', run: () => mutation.mutate({ pageId: saved.pageId, body: toast.undo }) })
      }
    },
    onSettled: (_d, _e, { pageId }) => {
      // Refetch only once the last patch settles: an earlier refetch would bring back the
      // server's copy over edits still in flight. (This mutation still counts as one.)
      if (qc.isMutating({ mutationKey: PATCH_KEY }) > 1) return
      return Promise.all([
        qc.invalidateQueries({ queryKey: LIBRARY_KEY }),
        qc.invalidateQueries({ queryKey: titleKey(pageId) }),
      ])
    },
  })
  return mutation
}

/** Create a tag in a group (or move it there): PUT /api/tags/:tag/group. */
export function useSetTagGroup() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ tag, group }: { tag: string; group: string | null }) => api.setTagGroup(tag, group),
    onMutate: async ({ tag, group }) => {
      await qc.cancelQueries({ queryKey: LIBRARY_KEY })
      const before = qc.getQueryData<LibraryResponse>(LIBRARY_KEY)
      if (before) {
        const known = before.tags.some((x) => x.title.toLowerCase() === tag.toLowerCase())
        const tags = known
          ? before.tags.map((x) => {
            if (x.title.toLowerCase() !== tag.toLowerCase()) return x
            return group ? { ...x, group } : { title: x.title, count: x.count }
          })
          : [...before.tags, group ? { title: tag, group, count: 0 } : { title: tag, count: 0 }]
        qc.setQueryData<LibraryResponse>(LIBRARY_KEY, { ...before, tags })
      }
      return { before }
    },
    onError: (err, _vars, ctx) => {
      if (ctx?.before) qc.setQueryData(LIBRARY_KEY, ctx.before)
      showToast(`Couldn’t save the tag: ${err.message}`)
    },
    onSettled: () => qc.invalidateQueries({ queryKey: LIBRARY_KEY }),
  })
}

/** Rename a tag group: POST /api/groups/rename. */
export function useRenameGroup() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ from, to }: { from: string; to: string }) => api.renameGroup(from, to),
    onMutate: async ({ from, to }) => {
      await qc.cancelQueries({ queryKey: LIBRARY_KEY })
      const before = qc.getQueryData<LibraryResponse>(LIBRARY_KEY)
      if (before) {
        qc.setQueryData<LibraryResponse>(LIBRARY_KEY, {
          ...before,
          tags: before.tags.map((t) => (t.group === from ? { ...t, group: to } : t)),
        })
      }
      return { before }
    },
    onError: (err, _vars, ctx) => {
      if (ctx?.before) qc.setQueryData(LIBRARY_KEY, ctx.before)
      showToast(`Couldn’t rename the group: ${err.message}`)
    },
    onSettled: () => qc.invalidateQueries({ queryKey: LIBRARY_KEY }),
  })
}

/** Fix a Needs a look title from a lookup result: POST /api/titles/:pageId/match. */
export function useMatchTitle() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ pageId, id }: { pageId: string; id: string }) => api.match(pageId, id),
    onSuccess: (saved) => storeTitle(qc, saved),
    onError: (err) => showToast(`Couldn’t use that match: ${err.message}`),
    onSettled: (_d, _e, { pageId }) => Promise.all([
      qc.invalidateQueries({ queryKey: LIBRARY_KEY }),
      qc.invalidateQueries({ queryKey: titleKey(pageId) }),
    ]),
  })
}

/** Add a note (POST /api/titles/:pageId/notes) or edit one (PUT /api/notes/:blockId). */
export function useSaveNote() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ pageId, noteId, text }: { pageId: string; noteId?: string; text: string }) =>
      noteId ? api.editNote(noteId, text) : api.addNote(pageId, text),
    onMutate: async ({ pageId, noteId, text }) => {
      await qc.cancelQueries({ queryKey: titleKey(pageId) })
      const before = qc.getQueryData<TitleDetailResponse>(titleKey(pageId))
      if (before) {
        const notes = noteId
          ? before.notes.map((n) => (n.id === noteId ? { ...n, text } : n))
          : [...before.notes, { id: `pending-${Date.now()}`, text }]
        qc.setQueryData<TitleDetailResponse>(titleKey(pageId), { ...before, notes })
      }
      return { before }
    },
    onError: (err, { pageId }, ctx) => {
      if (ctx?.before) qc.setQueryData(titleKey(pageId), ctx.before)
      showToast(`Couldn’t save the note: ${err.message}`)
    },
    onSettled: (_d, _e, { pageId }) => Promise.all([
      qc.invalidateQueries({ queryKey: LIBRARY_KEY }),
      qc.invalidateQueries({ queryKey: titleKey(pageId) }),
    ]),
  })
}

/** Take a title off Hoard's lists: DELETE /api/titles/:pageId/hoard. The Grimoire page stays. */
export function useRemoveFromHoard() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ pageId }: { pageId: string }) => api.removeFromHoard(pageId),
    onSuccess: (_d, { pageId }) => {
      qc.setQueryData<LibraryResponse>(LIBRARY_KEY, (lib) => lib && {
        ...lib, titles: lib.titles.filter((t) => t.pageId !== pageId),
      })
      // The detail query is left alone: the title page is still mounted until the caller
      // navigates away, and dropping it there would refetch and flash a 404.
    },
    onError: (err) => showToast(`Couldn’t remove it: ${err.message}`),
    onSettled: () => qc.invalidateQueries({ queryKey: LIBRARY_KEY }),
  })
}

/** Add a title: POST /api/titles. An existing match comes back with existed: true. */
export function useCreateTitle() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: CreateTitleBody) => api.createTitle(body),
    onSuccess: ({ title }) => {
      qc.setQueryData<LibraryResponse>(LIBRARY_KEY, (lib) => lib && (
        lib.titles.some((t) => t.pageId === title.pageId)
          ? lib
          : { ...lib, titles: [...lib.titles, { ...title, onEdgar: null }] }
      ))
    },
    onError: (err) => showToast(`Couldn’t add it: ${err.message}`),
    onSettled: () => qc.invalidateQueries({ queryKey: LIBRARY_KEY }),
  })
}

/** Lookup matches for a name (GET /api/lookup). Games have no lookup. */
export function useLookup(type: MediaType, q: string) {
  const query = q.trim()
  return useQuery({
    queryKey: ['lookup', type, query],
    queryFn: () => api.lookup(type, query),
    enabled: type !== 'game' && query !== '',
    staleTime: 5 * 60_000,
  })
}
