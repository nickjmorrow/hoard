// Tags by group, with how many titles use each. Make a tag in a group, move a tag to another
// group (or a new one), rename a group. Ungrouped tags sit under Other.
// Renaming a single tag isn't in the API yet, so it isn't offered here.

import { useId, useState, type FormEvent } from 'react'
import type { TagInfo } from './apiTypes.ts'
import { Dropdown, RadioOption } from './Dropdown.tsx'
import { groupTags, OTHER_GROUP } from './filter.ts'
import { useLibrary, useRenameGroup, useSetTagGroup } from './queries.ts'
import { back } from './router.ts'
import { showToast } from './toast.tsx'

export function Tags() {
  const { data, error, isPending } = useLibrary()
  const tags = data?.tags ?? []
  const groups = groupTags(tags)
  const groupNames = groups.map(([g]) => g).filter((g) => g !== OTHER_GROUP)
  // Other always shows, so a new ungrouped tag has somewhere to go.
  const shown: [string, TagInfo[]][] = groups.some(([g]) => g === OTHER_GROUP) ? groups : [...groups, [OTHER_GROUP, []]]

  return (
    <div className="screen">
      <header className="top">
        <div className="brand">
          <button type="button" className="link pad" onClick={() => back('/')}>‹ Library</button>
          <h1>Tags</h1>
          <span className="brand-spacer" aria-hidden="true" />
        </div>
      </header>
      <main className="tags-body">
        {isPending && <p className="empty">Loading tags…</p>}
        {error && <p className="empty">Can’t load tags. {error.message}</p>}
        {data && shown.map(([group, inGroup]) => (
          <Group key={group} group={group} tags={inGroup} all={tags} groupNames={groupNames} />
        ))}
        {data && <p className="hint">Tap a tag to move it to another group. Tags with no group land in Other.</p>}
      </main>
    </div>
  )
}

function Group({ group, tags, all, groupNames }: { group: string; tags: TagInfo[]; all: TagInfo[]; groupNames: string[] }) {
  const [mode, setMode] = useState<'idle' | 'rename' | 'add'>('idle')
  const [text, setText] = useState('')
  const rename = useRenameGroup()
  const setGroup = useSetTagGroup()
  const isOther = group === OTHER_GROUP
  const headingId = useId()

  const start = (m: 'rename' | 'add') => {
    setText(m === 'rename' ? group : '')
    setMode(m)
  }

  const submit = (e: FormEvent) => {
    e.preventDefault()
    const value = text.trim()
    setMode('idle')
    if (!value) return
    if (mode === 'rename') {
      if (value !== group) rename.mutate({ from: group, to: value })
      return
    }
    const clash = all.find((t) => t.title.toLowerCase() === value.toLowerCase())
    if (clash) showToast(`${clash.title} already exists, in ${clash.group ?? OTHER_GROUP}.`)
    else setGroup.mutate({ tag: value, group: isOther ? null : group })
  }

  return (
    <section className="grp" aria-labelledby={headingId}>
      <div className="gn">
        {mode === 'rename' ? (
          <form className="inline-form" onSubmit={submit}>
            <input aria-label={`New name for ${group}`} autoFocus value={text} onChange={(e) => setText(e.target.value)} />
            <button type="submit" className="btn small">Save</button>
            <button type="button" className="link pad" onClick={() => setMode('idle')}>Cancel</button>
          </form>
        ) : (
          <>
            <h2 id={headingId}>{group}</h2>
            <span className="gn-actions">
              {!isOther && <button type="button" className="link pad" onClick={() => start('rename')}>Rename</button>}
              <button type="button" className="link pad" aria-label={`New tag in ${group}`} onClick={() => start('add')}>+ tag</button>
            </span>
          </>
        )}
      </div>
      {mode === 'add' && (
        <form className="inline-form" onSubmit={submit}>
          <input aria-label={`New tag in ${group}`} placeholder="Tag name" autoFocus value={text} onChange={(e) => setText(e.target.value)} />
          <button type="submit" className="btn small">Add</button>
          <button type="button" className="link pad" onClick={() => setMode('idle')}>Cancel</button>
        </form>
      )}
      {tags.length === 0 && mode !== 'add' && <p className="hint">No tags here.</p>}
      <div className="tagps">
        {tags.map((tag) => <TagChip key={tag.title} tag={tag} groupNames={groupNames} />)}
      </div>
    </section>
  )
}

function TagChip({ tag, groupNames }: { tag: TagInfo; groupNames: string[] }) {
  const setGroup = useSetTagGroup()
  const [name, setName] = useState('')
  const current = tag.group ?? OTHER_GROUP
  const move = (group: string | null) => {
    if ((group ?? OTHER_GROUP) !== current) setGroup.mutate({ tag: tag.title, group })
  }
  const label = <>{tag.title} <span className="n">{tag.count}</span></>

  return (
    <Dropdown label={label} ariaLabel={`${tag.title}, ${tag.count} titles, in ${current}`} heading={`Move ${tag.title} to`}>
      {(close) => (
        <>
          {[...groupNames, OTHER_GROUP].map((g) => (
            <RadioOption
              key={g}
              name={`group-${tag.title}`}
              label={g}
              checked={g === current}
              onChoose={() => { move(g === OTHER_GROUP ? null : g); close() }}
            />
          ))}
          <form
            className="new"
            onSubmit={(e) => {
              e.preventDefault()
              const g = name.trim()
              if (g) move(g === OTHER_GROUP ? null : g)
              setName('')
              close()
            }}
          >
            <input aria-label="New group" placeholder="New group" value={name} onChange={(e) => setName(e.target.value)} />
            <button type="submit">Move</button>
          </form>
        </>
      )}
    </Dropdown>
  )
}
