// Starts the Hoard server on 127.0.0.1 (the host puts it behind its own proxy).

import { serve } from '@hono/node-server'
import { createApp } from './app.ts'
import { serverConfig } from './config.ts'
import { AutoTagger, ClaudeTagPicker } from './autoTag.ts'
import { startBackups } from './backup.ts'
import { Enricher } from './enricher.ts'
import { Library } from './library.ts'
import { Store } from './store.ts'
import { checkUnverified, ClaudeSuggester } from './suggest.ts'
import { createJellyfin } from './jellyfin.ts'
import { createLookup } from './lookup.ts'
import { startWatchedLoop } from './watched.ts'

function config(): { port: number; dataDir: string } {
  try {
    return serverConfig(process.env)
  } catch (err) {
    console.error(`hoard: ${(err as Error).message}`)
    process.exit(1)
  }
}

const { port, dataDir } = config()
const store = new Store(`${dataDir}/hoard.db`)
const library = new Library(store)
startBackups(store, `${dataDir}/backups`)
const lookup = createLookup() // OMDB_API_KEY; without it, movies and shows are skipped
const jellyfin = createJellyfin() // JELLYFIN_URL, JELLYFIN_API_KEY; without them, onEdgar is unknown
const enricher = new Enricher(library, lookup)
enricher.onPoster = (imdb, url) => store.setPoster(imdb, url)
const tagger = new AutoTagger(library, new ClaudeTagPicker())

// The watched loop is also what refreshes Jellyfin, so the app's onEdgar answers come from it.
enricher.start()
// Suggestions saved while OMDb was out get their details (RT, poster) once it's back.
const checkSuggestions = () => void checkUnverified(store, lookup).catch((e) => console.error('checking suggestions:', e))
checkSuggestions()
setInterval(checkSuggestions, 30 * 60_000)
startWatchedLoop(library, jellyfin)

const app = createApp({
  library,
  availability: jellyfin,
  lookup,
  store,
  suggester: new ClaudeSuggester(),
  // Details first, so Claude sees the genre and summary when it picks tags.
  onCreated: (pageId) => void enricher.enrichNow(pageId).then(() => tagger.tagNow(pageId)),
})
serve({ fetch: app.fetch, hostname: '127.0.0.1', port }, (info) => {
  console.log(`hoard listening on http://127.0.0.1:${info.port}`)
})
