import type { Title } from '../shared/title.ts'
import type { Jellyfin, JellyfinItem } from './jellyfin.ts'
import { imdbFromJellyfin } from './jellyfinMatch.ts'
import type { TitleStore } from './titleStore.ts'
import { localDate } from '../shared/localDate.ts'

/** A want/doing title becomes done only if Jellyfin says it was played after the page's last edit. */
export function decideWatched(title: Title, item: JellyfinItem): { status: 'done'; finished: string } | null {
  if (!item.played || !item.lastPlayed) return null
  if (title.status !== 'want' && title.status !== 'doing') return null
  const played = Date.parse(item.lastPlayed)
  if (Number.isNaN(played) || played <= title.updatedAt) return null
  return { status: 'done', finished: localDate(played) }
}

/** One pass: marks watched titles done. Returns how many were marked. Does nothing if Jellyfin is down. */
export async function runWatchedOnce(g: TitleStore, j: Jellyfin): Promise<number> {
  if (!(await j.refresh())) return 0
  const items = j.items()
  const byImdb = new Map(items.map((i) => [i.imdb.toLowerCase(), i]))
  const titles = await g.listTitles()
  const usedIds = new Set(titles.flatMap((t) => (t.imdb ? [t.imdb.toLowerCase()] : [])))
  let marked = 0
  for (const t of titles) {
    // A title without an IMDb ID gets it from Jellyfin when the match is clear. The ID and, if the title
    // was already played, "done" go in one write: any later write would count as an edit after the play.
    const filled = t.imdb ? null : imdbFromJellyfin(t, items, usedIds)
    const imdb = t.imdb ?? filled
    if (!imdb) continue
    const item = byImdb.get(imdb.toLowerCase())
    if (!item) continue
    const d = decideWatched({ ...t, imdb }, item)
    if (!d && !filled) continue
    const fields = { ...(filled ? { imdb: filled } : {}), ...(d ? { status: d.status, finished: d.finished } : {}) }
    try {
      if (d) await g.setFields(t.pageId, fields, { onlyIfStatus: ['want', 'doing'] })
      else await g.setFields(t.pageId, fields)
      if (filled) usedIds.add(filled.toLowerCase())
      if (d) marked++
    } catch (e) {
      console.error(`watched: ${t.pageTitle}: ${e instanceof Error ? e.message : String(e)}`)
    }
  }
  return marked
}

/** Runs a pass now and then every intervalMs, never overlapping. Returns a function that stops it. */
export function startWatchedLoop(g: TitleStore, j: Jellyfin, intervalMs = 300_000): () => void {
  let running = false
  const tick = () => {
    if (running) return
    running = true
    runWatchedOnce(g, j)
      .catch((e) => console.error('watched: run failed', e))
      .finally(() => { running = false })
  }
  tick()
  const timer = setInterval(tick, intervalMs)
  timer.unref()
  return () => clearInterval(timer)
}
