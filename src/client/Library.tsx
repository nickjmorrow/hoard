// The Library: a filter list. Type switch, search, a row of dropdowns (Status, one per tag group,
// then On the server), a sort menu, and rows with a circle that marks a title done.

import { useEffect, useState, type FormEvent, type ReactNode } from 'react'
import { MEDIA_TYPES, STATUSES, type MediaType, type Status } from '../shared/title.ts'
import type { TagInfo, TitleWithAvail } from './apiTypes.ts'
import { CheckOption, Dropdown, RadioOption } from './Dropdown.tsx'
import {
  applyFilters, emptyFilters, groupTags, isNeedsLook, OTHER_GROUP, prunePicks, type Filters, type SortKey,
} from './filter.ts'
import { useLibrary, usePatchTitle, useSetTagGroup } from './queries.ts'
import { navigate } from './router.ts'
import { ON_SERVER } from './serverName.ts'
import { showToast } from './toast.tsx'

const TYPE_LABEL: Record<MediaType, string> = { movie: 'Movies', show: 'Shows', game: 'Games' }
const STATUS_LABEL: Record<Status, string> = { want: 'Want', doing: 'Doing', done: 'Done', dropped: 'Dropped' }
const SORTS: { key: SortKey; label: string }[] = [
  { key: 'added', label: 'Recently added' },
  { key: 'rt', label: 'Rotten Tomatoes ↓' },
  { key: 'rating', label: 'Your rating ↓' },
  { key: 'year', label: 'Year ↓' },
  { key: 'runtime', label: 'Runtime ↑' },
]

// Filters survive going to a title page and back (and a reload), per browser tab.
const STORE_KEY = 'hoard.filters'

function loadFilters(): Filters {
  try {
    const raw = sessionStorage.getItem(STORE_KEY)
    if (raw) {
      const saved = { ...emptyFilters(), ...(JSON.parse(raw) as Partial<Filters>) }
      if (MEDIA_TYPES.includes(saved.type)) return saved
    }
  } catch { /* storage blocked or bad JSON: start fresh */ }
  return emptyFilters()
}

function saveFilters(f: Filters): void {
  try { sessionStorage.setItem(STORE_KEY, JSON.stringify(f)) } catch { /* not important */ }
}

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? '' : 's'}`
}

/** `selected`: the title open beside the list on wide screens. */
export function Library({ selected }: { selected?: string } = {}) {
  const { data, error, isPending, refetch } = useLibrary()
  const [f, setF] = useState<Filters>(loadFilters)
  useEffect(() => saveFilters(f), [f])
  const update = (patch: Partial<Filters>) => setF((cur) => ({ ...cur, ...patch }))

  const titles = data?.titles ?? []
  const tags = data?.tags ?? []
  // Once tags are known, forget picks a group rename or tag move made stale (they persist otherwise).
  useEffect(() => {
    if (!data) return
    setF((cur) => {
      const live = prunePicks(cur.tagsByGroup, data.tags)
      return JSON.stringify(live) === JSON.stringify(cur.tagsByGroup) ? cur : { ...cur, tagsByGroup: live }
    })
  }, [data])
  const jellyfinUp = data?.jellyfinUp ?? true
  const now = Date.now()

  // The On-the-server toggle can't mean anything while Jellyfin is down, so it's off and hidden.
  const effective: Filters = !jellyfinUp ? { ...f, onEdgar: false } : f
  const shown = applyFilters(titles, tags, effective, now)
  const ofType = titles.filter((t) => t.type === f.type)
  const needsLookCount = ofType.filter((t) => isNeedsLook(t, now)).length
  const groups = groupTags(tags)
  // Lives here, not in the row: a row filtered out by its own change unmounts before the save answers.
  const patch = usePatchTitle()
  const markDone = (t: TitleWithAvail) => patch.mutate({
    pageId: t.pageId,
    body: { fields: { status: 'done' } },
    toast: { message: `Marked ${t.name} done.`, undo: { fields: { status: t.status, finished: t.finished ?? null } } },
  })
  const hasPicks = f.statuses.length > 0 || Object.values(f.tagsByGroup).some((x) => x.length > 0) ||
    f.onEdgar || f.needsLook || f.search.trim() !== ''

  return (
    <div className="screen">
      <header className="top">
        <div className="brand">
          <h1>Hoard</h1>
          <div className="brand-actions">
            <button type="button" className="link pad" onClick={() => navigate('/tags')}>Tags</button>
            <button type="button" className="plus" aria-label="Add a title" onClick={() => navigate('/add')}>+</button>
          </div>
        </div>
        <div className="seg" role="group" aria-label="Type">
          {MEDIA_TYPES.map((type) => (
            <button
              key={type}
              type="button"
              className={type === f.type ? 'on' : ''}
              aria-pressed={type === f.type}
              onClick={() => update({ type })}
            >
              {TYPE_LABEL[type]}
            </button>
          ))}
        </div>
      </header>

      <input
        className="search"
        type="search"
        placeholder="Search titles, people, notes…"
        aria-label="Search titles, people and notes"
        value={f.search}
        onChange={(e) => update({ search: e.target.value })}
      />

      <div className="dds">
        <StatusDropdown statuses={f.statuses} onChange={(statuses) => update({ statuses })} />
        {groups.map(([group, groupTags]) => (
          <TagGroupDropdown
            key={group}
            group={group}
            tags={groupTags}
            titles={ofType}
            picked={f.tagsByGroup[group] ?? []}
            onChange={(picked) => update({ tagsByGroup: { ...f.tagsByGroup, [group]: picked } })}
          />
        ))}
        {/* Not while loading: it would show, then vanish if Jellyfin turns out to be down. */}
        {(f.type === 'movie' || f.type === 'show') && data?.jellyfinUp === true && (
          <Toggle on={f.onEdgar} label={ON_SERVER} dot onChange={(onEdgar) => update({ onEdgar })} />
        )}
        {(needsLookCount > 0 || f.needsLook) && (
          <Toggle
            on={f.needsLook}
            label={`Needs a look${needsLookCount > 0 ? ` · ${needsLookCount}` : ''}`}
            onChange={(needsLook) => update({ needsLook })}
          />
        )}
      </div>

      {!jellyfinUp && (f.type === 'movie' || f.type === 'show') && (
        <p className="note">Jellyfin isn’t answering, so {ON_SERVER} is hidden for now.</p>
      )}

      <div className="sort">
        <span aria-live="polite">{data ? plural(shown.length, 'title') : ''}</span>
        <Dropdown
          className="right"
          label={<>Sort: {SORTS.find((s) => s.key === f.sort)?.label}</>}
          heading="Sort by"
        >
          {(close) => SORTS.map((s) => (
            <RadioOption
              key={s.key}
              name="sort"
              label={s.label}
              checked={f.sort === s.key}
              onChoose={() => { update({ sort: s.key }); close() }}
            />
          ))}
        </Dropdown>
      </div>

      <main className="list">
        {isPending && <p className="empty">Loading your library…</p>}
        {error && (
          <div className="empty">
            <p>Can’t load the library. {error.message}</p>
            <button type="button" className="link" onClick={() => void refetch()}>Try again</button>
          </div>
        )}
        {data && shown.length === 0 && (
          <div className="empty">
            <p>{ofType.length === 0 ? `No ${TYPE_LABEL[f.type].toLowerCase()} yet.` : 'Nothing matches these filters.'}</p>
            {hasPicks && (
              <button type="button" className="link" onClick={() => setF({ ...emptyFilters(f.type), sort: f.sort })}>
                Clear filters
              </button>
            )}
          </div>
        )}
        {shown.length > 0 && (
          <ul>
            {shown.map((t) => (
              <Row key={t.pageId} t={t} selected={t.pageId === selected} showEdgar={jellyfinUp} needsLook={isNeedsLook(t, now)} onDone={() => markDone(t)} />
            ))}
          </ul>
        )}
      </main>
    </div>
  )
}

function StatusDropdown({ statuses, onChange }: { statuses: Status[]; onChange: (s: Status[]) => void }) {
  const label = statuses.length === 0
    ? 'Status'
    : <>Status: <b>{statuses.length === 1 ? STATUS_LABEL[statuses[0]!] : statuses.length}</b></>
  return (
    <Dropdown label={label} active={statuses.length > 0} heading="Status">
      {() => STATUSES.map((s) => (
        <CheckOption
          key={s}
          label={STATUS_LABEL[s]}
          checked={statuses.includes(s)}
          onChange={(on) => onChange(on ? [...statuses, s] : statuses.filter((x) => x !== s))}
        />
      ))}
    </Dropdown>
  )
}

function TagGroupDropdown({ group, tags, titles, picked, onChange }: {
  group: string
  tags: TagInfo[]
  /** Titles of the current type, for per-type counts. */
  titles: TitleWithAvail[]
  picked: string[]
  onChange: (picked: string[]) => void
}) {
  const [adding, setAdding] = useState(false)
  const [name, setName] = useState('')
  const setTagGroup = useSetTagGroup()
  const isPicked = (tag: string) => picked.some((p) => p.toLowerCase() === tag.toLowerCase())
  const count = (tag: string) => titles.filter((t) => t.tags.some((x) => x.toLowerCase() === tag.toLowerCase())).length

  const label = picked.length === 0
    ? group
    : <>{group}: <b className="clip">{picked.length === 1 ? picked[0] : picked.length}</b></>

  const create = (e: FormEvent) => {
    e.preventDefault()
    const tag = name.trim()
    if (!tag) return
    const clash = tags.find((t) => t.title.toLowerCase() === tag.toLowerCase())
    if (clash) {
      showToast(`${clash.title} is already in ${group}.`)
    } else {
      setTagGroup.mutate({ tag, group: group === OTHER_GROUP ? null : group })
    }
    setName('')
    setAdding(false)
  }

  return (
    <Dropdown label={label} ariaLabel={`${group} tags`} active={picked.length > 0} heading={group}>
      {() => (
        <>
          {tags.map((tag) => (
            <CheckOption
              key={tag.title}
              label={tag.title}
              count={count(tag.title)}
              checked={isPicked(tag.title)}
              onChange={(on) => onChange(on ? [...picked, tag.title] : picked.filter((p) => p.toLowerCase() !== tag.title.toLowerCase()))}
            />
          ))}
          {adding ? (
            <form className="new" onSubmit={create}>
              <input
                autoFocus
                aria-label={`New tag in ${group}`}
                placeholder="Tag name"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
              <button type="submit">Add</button>
            </form>
          ) : (
            <button type="button" className="new" onClick={() => setAdding(true)}>+ New tag in {group}</button>
          )}
        </>
      )}
    </Dropdown>
  )
}

function Toggle({ on, label, dot = false, onChange }: { on: boolean; label: string; dot?: boolean; onChange: (on: boolean) => void }) {
  return (
    <button type="button" className={`dd${on ? ' on' : ''}`} aria-pressed={on} onClick={() => onChange(!on)}>
      {dot && <span className="dot" aria-hidden="true" />}
      <b>{label}</b>
    </button>
  )
}

function Row({ t, selected, showEdgar, needsLook, onDone }: {
  t: TitleWithAvail
  selected: boolean
  showEdgar: boolean
  needsLook: boolean
  onDone: () => void
}) {
  const done = t.status === 'done'

  const meta: ReactNode[] = []
  if (t.year !== undefined) meta.push(t.year)
  if (t.runtime !== undefined) meta.push(`${t.runtime}m`)
  if (t.genre?.length) meta.push(t.genre.join(', '))
  if (t.rt !== undefined) meta.push(<span className="rt" key="rt">{t.rt}%</span>)
  if (t.rating !== undefined) meta.push(<span key="rating" aria-label={`rated ${t.rating} of 5`}>{'★\u00a0'}{t.rating}</span>)
  if (t.status === 'doing') meta.push(t.progress ? `Doing · ${t.progress}` : 'Doing')
  if (t.status === 'dropped') meta.push('Dropped')

  const tagLine = [...t.tags, ...(t.rec ? [`rec: ${t.rec}`] : [])].join(' · ')

  return (
    <li className={`item${selected ? ' sel' : ''}`}>
      <button
        type="button"
        className="main"
        aria-current={selected ? 'page' : undefined}
        onClick={() => navigate(`/title/${encodeURIComponent(t.pageId)}`)}
      >
        <span className="tt">
          {showEdgar && t.onEdgar === true && <span className="dot" role="img" aria-label={ON_SERVER} />}
          {t.name}
        </span>
        {meta.length > 0 && (
          <span className="mm">
            {meta.map((m, i) => <span key={i}>{i > 0 && ' · '}{m}</span>)}
          </span>
        )}
        {needsLook && <span className="look">Needs a look</span>}
        {tagLine && <span className="tg">{tagLine}</span>}
      </button>
      <button
        type="button"
        className={`check${done ? ' done' : ''}`}
        disabled={done}
        aria-label={done ? `${t.name} is done` : `Mark ${t.name} done`}
        onClick={onDone}
      >
        <span aria-hidden="true">{done ? '✓' : ''}</span>
      </button>
    </li>
  )
}
