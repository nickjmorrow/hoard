// A tiny history-based router: useRoute() gives the current path, navigate() changes it.

import { useSyncExternalStore } from 'react'

const CHANGE = 'hoard:navigate'

// The page's own scroll position per path, so the library comes back where you left it.
const positions = new Map<string, number>()
function scroller(): Element {
  return document.scrollingElement ?? document.documentElement
}
if (typeof window !== 'undefined') {
  if ('scrollRestoration' in history) history.scrollRestoration = 'manual'
  window.addEventListener('scroll', () => positions.set(location.pathname, scroller().scrollTop), { passive: true })
}

/** After a route change: the library goes back to where it was, every other screen starts at the top. */
export function restoreScroll(path: string): void {
  scroller().scrollTop = path === '/' ? positions.get('/') ?? 0 : 0
}

/** Go to `path`. `replace` swaps the current history entry instead of adding one, so Back skips it. */
export function navigate(path: string, { replace = false } = {}): void {
  if (path === location.pathname + location.search) return
  positions.set(location.pathname, scroller().scrollTop)
  // Each entry remembers the screen it was opened from, for back().
  if (replace) history.replaceState(history.state, '', path)
  else history.pushState({ from: location.pathname }, '', path)
  window.dispatchEvent(new Event(CHANGE))
}

/**
 * Leave this screen for `path`: the browser's Back when this screen was opened from there, so a
 * phone's Back gesture doesn't then reopen it; otherwise `path` replaces this screen.
 */
export function back(path: string): void {
  const from = (history.state as { from?: string } | null)?.from
  if (from === path) history.back()
  else navigate(path, { replace: true })
}

function subscribe(l: () => void): () => void {
  window.addEventListener('popstate', l)
  window.addEventListener(CHANGE, l)
  return () => {
    window.removeEventListener('popstate', l)
    window.removeEventListener(CHANGE, l)
  }
}

/** The current pathname. */
export function useRoute(): string {
  return useSyncExternalStore(subscribe, () => location.pathname)
}

/** "/title/:pageId" -> { pageId } when `path` matches, else null. */
export function matchPath(pattern: string, path: string): Record<string, string> | null {
  const p = pattern.split('/')
  const s = path.split('/')
  if (p.length !== s.length) return null
  const params: Record<string, string> = {}
  for (let i = 0; i < p.length; i++) {
    const seg = p[i]!
    if (seg.startsWith(':')) params[seg.slice(1)] = decodeURIComponent(s[i]!)
    else if (seg !== s[i]) return null
  }
  return params
}
