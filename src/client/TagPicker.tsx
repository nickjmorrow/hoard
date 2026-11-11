// Pick tags for a title: a dropdown of existing tags by group, plus a field for a new one.
// Used on the title page and when adding.

import { useState, type FormEvent, type ReactNode } from 'react'
import type { TagInfo } from './apiTypes.ts'
import { CheckOption, Dropdown } from './Dropdown.tsx'
import { groupTags } from './filter.ts'

const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase()

export function TagPicker({ tags, picked, onChange, label, className = '' }: {
  tags: TagInfo[]
  picked: string[]
  onChange: (picked: string[]) => void
  label: ReactNode
  className?: string
}) {
  const [name, setName] = useState('')
  const has = (tag: string) => picked.some((p) => same(p, tag))

  const addNew = (e: FormEvent) => {
    e.preventDefault()
    const typed = name.trim()
    if (!typed) return
    // Reuse an existing tag's spelling so "anime" doesn't make a second Anime.
    const tag = tags.find((t) => same(t.title, typed))?.title ?? typed
    if (!has(tag)) onChange([...picked, tag])
    setName('')
  }

  return (
    <Dropdown label={label} ariaLabel="Choose tags" heading="Tags" className={className}>
      {() => (
        <>
          {groupTags(tags).map(([group, inGroup]) => (
            <div key={group} role="group" aria-label={group}>
              <div className="menu-sub">{group}</div>
              {inGroup.map((tag) => (
                <CheckOption
                  key={tag.title}
                  label={tag.title}
                  checked={has(tag.title)}
                  onChange={(on) => onChange(on ? [...picked, tag.title] : picked.filter((p) => !same(p, tag.title)))}
                />
              ))}
            </div>
          ))}
          <form className="new" onSubmit={addNew}>
            <input
              aria-label="New tag"
              placeholder="New tag"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
            <button type="submit">Add</button>
          </form>
        </>
      )}
    </Dropdown>
  )
}
