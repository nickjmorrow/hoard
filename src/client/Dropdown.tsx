// A filter chip that opens a small menu below it. Closes on Escape or a tap outside.
// The menu's left edge is placed so its layout box stays inside the viewport (or the
// scrolling pane it's in): a transform would only move the paint, and the untransformed
// box would still widen the page on a phone.

import { useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react'

interface DropdownProps {
  /** Chip content, e.g. "Vibe" or "Status: Want". */
  label: ReactNode
  /** Accessible name for the chip button when label alone isn't clear. */
  ariaLabel?: string
  /** Has picks: the chip is drawn highlighted. */
  active?: boolean
  /** Small heading at the top of the menu. */
  heading?: string
  className?: string
  /** Menu content; gets a close() for single-choice menus. */
  children: (close: () => void) => ReactNode
}

export function Dropdown({ label, ariaLabel, active = false, heading, className = '', children }: DropdownProps) {
  const [open, setOpen] = useState(false)
  const [left, setLeft] = useState<number | null>(null)
  const root = useRef<HTMLDivElement>(null)
  const menu = useRef<HTMLDivElement>(null)
  const button = useRef<HTMLButtonElement>(null)
  const id = useId()

  const close = () => {
    setOpen(false)
    button.current?.focus()
  }

  useEffect(() => {
    if (!open) return
    const onDown = (e: PointerEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close()
    }
    document.addEventListener('pointerdown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('pointerdown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  useLayoutEffect(() => {
    if (!open || !menu.current || !root.current) { setLeft(null); return }
    const wrap = root.current.getBoundingClientRect()
    const width = menu.current.offsetWidth
    const [lo, hi] = horizontalBounds(root.current)
    // Where CSS would put it: under the chip's left edge, or its right edge for .right menus.
    const natural = className.split(' ').includes('right') ? wrap.right - width : wrap.left
    const clamped = Math.max(lo + 8, Math.min(natural, hi - 8 - width))
    setLeft(clamped - wrap.left)
  }, [open, className])

  return (
    <div className={`dd-wrap ${className}`} ref={root}>
      <button
        ref={button}
        type="button"
        className={`dd${active ? ' on' : ''}${open ? ' open' : ''}`}
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        aria-label={ariaLabel}
        onClick={() => setOpen((o) => !o)}
      >
        {label} <span aria-hidden="true">▾</span>
      </button>
      {open && (
        <div className="menu" id={id} ref={menu} style={left === null ? undefined : { left: `${left}px`, right: 'auto' }}>
          {heading && <div className="menu-hd">{heading}</div>}
          {children(close)}
        </div>
      )}
    </div>
  )
}

/** A checkbox row inside a Dropdown menu. */
export function CheckOption({ label, checked, count, onChange }: {
  label: string
  checked: boolean
  count?: number
  onChange: (checked: boolean) => void
}) {
  return (
    <label className={`op${checked ? ' sel' : ''}`}>
      <span className="op-l">
        <input type="checkbox" className="bx" checked={checked} onChange={(e) => onChange(e.target.checked)} />
        {label}
      </span>
      {count !== undefined && <span className="n">{count}</span>}
    </label>
  )
}

/** A single-choice row inside a Dropdown menu. */
export function RadioOption({ label, name, checked, onChoose }: {
  label: string
  name: string
  checked: boolean
  onChoose: () => void
}) {
  return (
    <label className={`op${checked ? ' sel' : ''}`}>
      <span className="op-l">
        <input type="radio" className="bx round" name={name} checked={checked} onChange={onChoose} />
        {label}
      </span>
    </label>
  )
}

/** The left and right edges (in viewport pixels) the menu must stay within: the nearest
 *  ancestor that clips or scrolls sideways, else the viewport. */
function horizontalBounds(el: HTMLElement): [number, number] {
  for (let p = el.parentElement; p && p !== document.body && p !== document.documentElement; p = p.parentElement) {
    if (getComputedStyle(p).overflowX !== 'visible') {
      const r = p.getBoundingClientRect()
      return [r.left + p.clientLeft, r.left + p.clientLeft + p.clientWidth]
    }
  }
  return [0, document.documentElement.clientWidth]
}
