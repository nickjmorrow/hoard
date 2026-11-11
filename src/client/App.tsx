// Routes: the library at /, a title at /title/:pageId, /add and /tags.
// On wide screens (900px and up) the library and the open title sit side by side.

import { useLayoutEffect, useRef } from 'react'
import { AddTitle } from './AddTitle.tsx'
import { useWide } from './hooks.ts'
import { Library } from './Library.tsx'
import { matchPath, restoreScroll, useRoute } from './router.ts'
import { Tags } from './Tags.tsx'
import { TitlePage } from './TitlePage.tsx'

export function App() {
  const path = useRoute()
  const wide = useWide()
  const titlePane = useRef<HTMLDivElement>(null)
  const pageId = matchPath('/title/:pageId', path)?.pageId
  // A newly opened screen starts at its top (the library returns to where it was). On wide
  // screens the title pane scrolls on its own, so it's reset too; the list pane keeps its place.
  useLayoutEffect(() => {
    restoreScroll(path)
    if (titlePane.current) titlePane.current.scrollTop = 0
  }, [path])

  if (path === '/add') return <AddTitle />
  if (path === '/tags') return <Tags />

  if (wide) {
    return (
      <div className="split">
        <div className="pane list-pane"><Library selected={pageId} /></div>
        <div className="pane title-pane" ref={titlePane}>
          {pageId
            ? <TitlePage key={pageId} pageId={pageId} wide />
            : <p className="empty">Pick a title to see it here.</p>}
        </div>
      </div>
    )
  }
  if (pageId) return <TitlePage key={pageId} pageId={pageId} />
  return <Library />
}
