// Adding a title: pick a type, type a name, choose a lookup match (games skip lookup),
// set status, tags and recommender, save. A title that's already tracked opens its page instead.

import { useState } from 'react'
import { MEDIA_TYPES, STATUSES, type MediaType, type Status } from '../shared/title.ts'
import type { CreateTitleBody, LookupResult } from './apiTypes.ts'
import { useDebounced } from './hooks.ts'
import { useCreateTitle, useLibrary, useLookup } from './queries.ts'
import { ON_SERVER } from './serverName.ts'
import { back, navigate } from './router.ts'
import { TagPicker } from './TagPicker.tsx'
import { STATUS_LABEL } from './TitlePage.tsx'
import { showToast } from './toast.tsx'

const TYPE_NAME: Record<MediaType, string> = { movie: 'Movie', show: 'Show', game: 'Game' }

/** Start on the type the library was showing. */
function startType(): MediaType {
  try {
    const saved = JSON.parse(sessionStorage.getItem('hoard.filters') ?? '{}') as { type?: MediaType }
    if (saved.type && MEDIA_TYPES.includes(saved.type)) return saved.type
  } catch { /* fall through */ }
  return 'movie'
}

export function AddTitle() {
  const library = useLibrary()
  const [type, setType] = useState<MediaType>(startType)
  const [name, setName] = useState('')
  const [year, setYear] = useState('')
  const [chosen, setChosen] = useState<LookupResult | null>(null)
  const [status, setStatus] = useState<Status>('want')
  const [tags, setTags] = useState<string[]>([])
  const [rec, setRec] = useState('')
  const query = useDebounced(name, 300)
  const lookup = useLookup(type, query)
  const create = useCreateTitle()
  const titles = library.data?.titles ?? []
  const isGame = type === 'game'
  const typedYear = year.trim()
  const badYear = isGame && typedYear !== '' && !/^\d{4}$/.test(typedYear)

  // Only the Save button saves. Enter (or a phone's Search key) in a field must not: an unmatched
  // title would be saved at once, before a lookup match is chosen.
  // So there's no <form> here (the tag picker's own new-tag form also can't nest in one).
  const save = () => {
    const typed = name.trim()
    if (!typed) return
    if (badYear) return
    const y = isGame ? (typedYear ? Number(typedYear) : undefined) : chosen?.year
    const body: CreateTitleBody = {
      type,
      name: chosen?.name ?? typed,
      ...(y !== undefined ? { year: y } : {}),
      ...(chosen?.source === 'omdb' ? { imdb: chosen.id } : {}),
      fields: { status, ...(rec.trim() ? { rec: rec.trim() } : {}) },
      ...(tags.length > 0 ? { tags } : {}),
    }
    create.mutate(body, {
      onSuccess: ({ title, existed }) => {
        showToast(existed ? 'Already in Hoard' : `Added ${title.name}.`)
        navigate(`/title/${encodeURIComponent(title.pageId)}`, { replace: true })
      },
    })
  }

  return (
    <div className="screen">
      <header className="top">
        <div className="brand">
          <button type="button" className="link pad" onClick={() => back('/')}>Cancel</button>
          <h1>Add</h1>
          <span className="brand-spacer" aria-hidden="true" />
        </div>
        <div className="seg" role="group" aria-label="Type">
          {MEDIA_TYPES.map((x) => (
            <button
              key={x}
              type="button"
              className={x === type ? 'on' : ''}
              aria-pressed={x === type}
              onClick={() => { setType(x); setChosen(null) }}
            >
              {TYPE_NAME[x]}
            </button>
          ))}
        </div>
      </header>

      <div className="add-form">
        <input
          className="search"
          type="search"
          autoFocus
          placeholder={isGame ? 'Game name' : `Search for a ${TYPE_NAME[type].toLowerCase()}`}
          aria-label="Name"
          enterKeyHint="search"
          onKeyDown={(e) => { if (e.key === 'Enter') e.preventDefault() }}
          value={name}
          onChange={(e) => { setName(e.target.value); setChosen(null) }}
        />

        {isGame ? (
          <>
            <label className="kv inset-row">
              <span>Year (optional)</span>
              <input className="kv-in" inputMode="numeric" value={year} onChange={(e) => setYear(e.target.value)} placeholder="e.g. 2021" />
            </label>
            {badYear && <p className="hint inset-row">A year has 4 digits, like 2021.</p>}
          </>
        ) : (
          <ul className="results add-results" aria-label="Matches">
            {lookup.isFetching && !lookup.data && <li className="hint inset-row">Looking…</li>}
            {lookup.error && <li className="hint inset-row">Lookup failed: {lookup.error.message}</li>}
            {lookup.data?.length === 0 && query.trim() && (
              <li className="hint inset-row">No matches. You can still save it; Hoard will look again later.</li>
            )}
            {lookup.data?.map((r) => {
              const have = r.source === 'omdb' ? titles.find((t) => t.imdb === r.id) : undefined
              const picked = chosen?.id === r.id
              return (
                <li key={r.id}>
                  <button type="button" className={`res${picked ? ' sel' : ''}`} aria-pressed={picked} onClick={() => setChosen(picked ? null : r)}>
                    <span className="tt">{r.name}{r.year !== undefined ? ` (${r.year})` : ''}</span>
                    {r.detail && <span className="mm">{r.detail}</span>}
                    {have?.onEdgar === true && <span className="have"><span className="dot" aria-hidden="true" /> {ON_SERVER}</span>}
                    {have && <span className="mm">Already in Hoard</span>}
                  </button>
                </li>
              )
            })}
          </ul>
        )}

        <div className="sheet">
          <label className="row">
            <span>Status</span>
            <select className="kv-in" value={status} onChange={(e) => setStatus(e.target.value as Status)}>
              {STATUSES.map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
            </select>
          </label>
          <div className="row">
            <span>Tags</span>
            <TagPicker
              className="right"
              tags={library.data?.tags ?? []}
              picked={tags}
              onChange={setTags}
              label={tags.length > 0 ? <b className="clip tagtxt">{tags.join(', ')}</b> : 'None'}
            />
          </div>
          <label className="row">
            <span>Recommended by</span>
            <input className="kv-in" value={rec} onChange={(e) => setRec(e.target.value)} placeholder="Nobody" />
          </label>
          {!isGame && !chosen && name.trim() && (
            <p className="hint">No match picked: it’s saved as typed and Hoard looks for details later.</p>
          )}
          <button type="button" className="btn save" onClick={save} disabled={!name.trim() || badYear || create.isPending}>
            {create.isPending ? 'Saving…' : 'Save to Hoard'}
          </button>
        </div>
      </div>
      <p className="hint inset-row">Already tracked? Saving opens its page instead.</p>
    </div>
  )
}
