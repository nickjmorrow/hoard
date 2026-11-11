// Small shared hooks.

import { useEffect, useState, useSyncExternalStore } from 'react'

/** `value`, once it has stopped changing for `ms`. */
export function useDebounced<T>(value: T, ms = 300): T {
  const [settled, setSettled] = useState(value)
  useEffect(() => {
    const id = setTimeout(() => setSettled(value), ms)
    return () => clearTimeout(id)
  }, [value, ms])
  return settled
}

const WIDE = '(min-width: 900px)'

function wideQuery(): MediaQueryList | null {
  return typeof window.matchMedia === 'function' ? window.matchMedia(WIDE) : null
}

/** True on screens at least 900px wide, where the list and the open title sit side by side. */
export function useWide(): boolean {
  return useSyncExternalStore(
    (l) => {
      const mq = wideQuery()
      mq?.addEventListener('change', l)
      return () => mq?.removeEventListener('change', l)
    },
    () => wideQuery()?.matches ?? false,
  )
}
