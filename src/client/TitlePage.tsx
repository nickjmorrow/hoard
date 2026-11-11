// One title: meta line, summary, badges, status, stars, tags, details and notes.
// Every change saves at once. Fields come from the library's copy when it has one (that's what
// optimistic edits update first) and fall back to the title's own query; notes come from the latter.

import { useEffect, useRef, useState, type ReactNode } from 'react'
import { STATUSES, type MediaType, type Status } from '../shared/title.ts'
import type { PatchTitleBody, TitleWithAvail } from './apiTypes.ts'
import { formatDate } from './dates.ts'
import { groupIndex, isNeedsLook, OTHER_GROUP } from './filter.ts'
import { useDebounced } from './hooks.ts'
import {
  useLibrary, useLookup, useMatchTitle, usePatchTitle, useRemoveFromHoard, useSaveNote, useTitleDetail,
} from './queries.ts'
import { back } from './router.ts'
import { ON_SERVER } from './serverName.ts'
import { Stars } from './Stars.tsx'
import { TagPicker } from './TagPicker.tsx'
import { showToast } from './toast.tsx'

const TYPE_NAME: Record<MediaType, string> = { movie: 'Movie', show: 'Show', game: 'Game' }
export const STATUS_LABEL: Record<Status, string> = { want: 'Want', doing: 'Doing', done: 'Done', dropped: 'Dropped' }

export function TitlePage({ pageId, wide = false }: { pageId: string; wide?: boolean }) {
  const detail = useTitleDetail(pageId)
  const library = useLibrary()
  const t: TitleWithAvail | undefined = library.data?.titles.find((x) => x.pageId === pageId) ?? detail.data
  const patch = usePatchTitle()

  const nav = (
    <nav className="tnav">
      {!wide && <button type="button" className="link pad" onClick={() => back('/')}>‹ Library</button>}
    </nav>
  )

  if (!t) {
    return (
      <div className="screen title-page">
        {nav}
        {detail.error
          ? <p className="empty">Can’t open this title. {detail.error.message}</p>
          : <p className="empty">Loading…</p>}
      </div>
    )
  }

  const save = (fields: NonNullable<PatchTitleBody['fields']>) => patch.mutate({ pageId, body: { fields } })
  const tags = library.data?.tags ?? []
  const groupOf = groupIndex(tags)

  const meta: string[] = [TYPE_NAME[t.type]]
  if (t.year !== undefined) meta.push(String(t.year))
  if (t.runtime !== undefined) meta.push(`${t.runtime}m`)
  if (t.genre?.length) meta.push(t.genre.join(', '))

  return (
    <div className="screen title-page">
      {nav}
      <main className="tbody">
        <h1 className="tname">{t.name}</h1>
        <p className="tmeta">{meta.join(' · ')}</p>
        {t.summary && <p className="tsummary">{t.summary}</p>}

        <div className="badges">
          {t.rt !== undefined && <span className="badge"><span className="rt">{t.rt}%</span> Rotten Tomatoes</span>}
          {t.onEdgar === true && <span className="badge onserver"><span className="dot" aria-hidden="true" /> {ON_SERVER} · in Infuse</span>}
          {t.imdb && (
            <a className="badge link-badge" href={`https://www.imdb.com/title/${encodeURIComponent(t.imdb)}/`} target="_blank" rel="noreferrer">
              IMDb ↗
            </a>
          )}
        </div>

        {isNeedsLook(t) && <NeedsLook t={t} />}

        <Section label="Status">
          <div className="status" role="group" aria-label="Status">
            {STATUSES.map((s) => (
              <button
                key={s}
                type="button"
                className={t.status === s ? 'on' : ''}
                aria-pressed={t.status === s}
                onClick={() => { if (t.status !== s) save({ status: s }) }}
              >
                {STATUS_LABEL[s]}
              </button>
            ))}
          </div>
        </Section>

        <Section label="Rating">
          <Stars rating={t.rating} onRate={(r) => save({ rating: r === null ? null : String(r) })} />
        </Section>

        <Section label="Tags">
          <ul className="tagrow">
            {t.tags.map((tag) => {
              const group = groupOf.get(tag.toLowerCase()) ?? OTHER_GROUP
              return (
                <li key={tag} className="tag">
                  {group !== OTHER_GROUP && <i>{group}</i>}
                  {tag}
                  <button
                    type="button"
                    className="tag-x"
                    aria-label={`Remove tag ${tag}`}
                    onClick={() => patch.mutate({ pageId, body: { tags: t.tags.filter((x) => x !== tag) } })}
                  >
                    ×
                  </button>
                </li>
              )
            })}
            <li>
              <TagPicker
                className="tag-add"
                tags={tags}
                picked={t.tags}
                label="+ tag"
                onChange={(next) => patch.mutate({ pageId, body: { tags: next } })}
              />
            </li>
          </ul>
        </Section>

        <Section label="Details">
          <InlineField label="Recommended by" value={t.rec} placeholder="Nobody yet" onSave={(v) => save({ rec: v })} />
          {t.type === 'show' && t.status === 'doing' && (
            <InlineField label="Progress" value={t.progress} placeholder="e.g. season 2" onSave={(v) => save({ progress: v })} />
          )}
          {t.finished && (
            <div className="kv"><span>Finished</span><span>{formatDate(t.finished)}</span></div>
          )}
        </Section>

        <Section label="Notes & review">
          <Notes pageId={pageId} notes={detail.data?.notes} />
        </Section>
      </main>
      <RemoveFooter pageId={pageId} name={t.name} />
    </div>
  )
}

function Section({ label, children }: { label: string; children: ReactNode }) {
  return (
    <section className="tsec">
      <h2 className="lbl">{label}</h2>
      {children}
    </section>
  )
}

/** A label and a text field that saves when you leave it or press Enter. Empty removes the value. */
function InlineField({ label, value, placeholder, onSave }: {
  label: string
  value: string | undefined
  placeholder: string
  onSave: (v: string | null) => void
}) {
  const [draft, setDraft] = useState(value ?? '')
  useEffect(() => setDraft(value ?? ''), [value])
  const commit = () => {
    const v = draft.trim()
    if (v !== (value ?? '')) onSave(v === '' ? null : v)
  }
  return (
    <label className="kv">
      <span>{label}</span>
      <input
        className="kv-in"
        value={draft}
        placeholder={placeholder}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') e.currentTarget.blur()
          if (e.key === 'Escape') setDraft(value ?? '')
        }}
      />
    </label>
  )
}

/** Lookup matches to choose from when the enricher couldn't pick one on its own. */
function NeedsLook({ t }: { t: TitleWithAvail }) {
  const [q, setQ] = useState(t.name)
  const query = useDebounced(q, 300)
  const lookup = useLookup(t.type, query)
  const match = useMatchTitle()
  return (
    <section className="look-panel" aria-label="Needs a look">
      <h2 className="look-hd">Needs a look</h2>
      <p className="look-p">Hoard couldn’t tell which one this is. Pick the right match to fill in its details.</p>
      <input
        className="search inset"
        type="search"
        aria-label="Search for a match"
        value={q}
        onChange={(e) => setQ(e.target.value)}
      />
      {lookup.isFetching && !lookup.data && <p className="look-p">Looking…</p>}
      {lookup.error && <p className="look-p">Lookup failed: {lookup.error.message}</p>}
      {lookup.data?.length === 0 && <p className="look-p">No matches. Try another spelling.</p>}
      <ul className="results">
        {lookup.data?.map((r) => (
          <li key={r.id}>
            <button
              type="button"
              className="res"
              disabled={match.isPending}
              onClick={() => match.mutate({ pageId: t.pageId, id: r.id })}
            >
              <span className="tt">{r.name}{r.year !== undefined ? ` (${r.year})` : ''}</span>
              {r.detail && <span className="mm">{r.detail}</span>}
            </button>
          </li>
        ))}
      </ul>
    </section>
  )
}

function Notes({ pageId, notes }: { pageId: string; notes: { id: string; text: string }[] | undefined }) {
  const saveNote = useSaveNote()
  const [adding, setAdding] = useState(false)
  if (!notes) return <p className="hint">Loading notes…</p>
  return (
    <>
      {notes.map((n) => (
        <Note key={n.id} text={n.text} pending={n.id.startsWith('pending-')} onSave={(text) => saveNote.mutate({ pageId, noteId: n.id, text })} />
      ))}
      {adding ? (
        <NoteEditor
          initial=""
          label="New note"
          onDone={(text) => {
            setAdding(false)
            if (text) saveNote.mutate({ pageId, text })
          }}
        />
      ) : (
        <button type="button" className="link pad" onClick={() => setAdding(true)}>+ Add a note</button>
      )}
    </>
  )
}

function Note({ text, pending, onSave }: { text: string; pending: boolean; onSave: (text: string) => void }) {
  const [editing, setEditing] = useState(false)
  if (editing) {
    return (
      <NoteEditor
        initial={text}
        label="Edit note"
        onDone={(next) => {
          setEditing(false)
          if (next && next !== text) onSave(next)
        }}
      />
    )
  }
  return (
    <button type="button" className="tnote" disabled={pending} title="Tap to edit" onClick={() => setEditing(true)}>
      {text}
    </button>
  )
}

/** A note being written. Leaving the field saves it; Escape drops the change. */
function NoteEditor({ initial, label, onDone }: { initial: string; label: string; onDone: (text: string) => void }) {
  const [draft, setDraft] = useState(initial)
  const cancelled = useRef(false)
  return (
    <textarea
      className="tnote tnote-edit"
      aria-label={label}
      autoFocus
      rows={4}
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          cancelled.current = true
          e.currentTarget.blur()
        }
      }}
      onBlur={() => onDone(cancelled.current ? '' : draft.trim())}
    />
  )
}

function RemoveFooter({ pageId, name }: { pageId: string; name: string }) {
  const [asking, setAsking] = useState(false)
  const remove = useRemoveFromHoard()
  return (
    <footer className="tfoot">
      {asking ? (
        <div className="confirm" role="alertdialog" aria-labelledby="remove-q" aria-describedby="remove-d">
          <p id="remove-q" className="confirm-q">Remove {name} from Hoard?</p>
          <p id="remove-d" className="hint">Its rating, tags and notes in Hoard are deleted. Anything you wrote in Grimoire stays.</p>
          <div className="confirm-actions">
            <button type="button" className="btn ghost" autoFocus onClick={() => setAsking(false)}>Cancel</button>
            <button
              type="button"
              className="btn danger"
              disabled={remove.isPending}
              onClick={() => remove.mutate({ pageId }, {
                onSuccess: () => {
                  showToast(`Removed ${name} from Hoard.`)
                  back('/')
                },
              })}
            >
              Remove
            </button>
          </div>
        </div>
      ) : (
        <button type="button" className="link danger-link pad" onClick={() => setAsking(true)}>Remove from Hoard</button>
      )}
    </footer>
  )
}
