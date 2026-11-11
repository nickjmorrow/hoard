// Starts Hoard against a throwaway store with a few seeded titles, for the Playwright checks.
// Never touches Hoard's real store or server. The store is deleted when the process exits.
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const dir = mkdtempSync(join(tmpdir(), 'hoard-e2e-'))
process.env.HOARD_DATA = dir
process.env.PORT ??= '8799'
delete process.env.OMDB_API_KEY
delete process.env.JELLYFIN_URL
delete process.env.JELLYFIN_API_KEY
for (const sig of ['exit', 'SIGINT', 'SIGTERM'] as const) process.on(sig, () => { rmSync(dir, { recursive: true, force: true }); if (sig !== 'exit') process.exit(0) })

const { Store } = await import('../src/server/store.ts')
const store = new Store(join(dir, 'hoard.db'))
const seed = [
  { name: 'Below the Ridge', year: 2005, tags: ['Rainy Day'] },
  { name: 'Supper Club', year: 2022, tags: ['Cozy Mystery'] },
  { name: 'The Lodger', year: 2013, tags: ['Cozy Mystery'] },
  { name: 'Red Meadow', year: 2018, tags: [] },
]
for (const s of seed) store.createTitle({ name: s.name, year: s.year, type: 'movie', fields: { status: 'want', year: String(s.year) }, tags: s.tags })
store.createTitle({ name: 'Overtime', year: 2022, type: 'show', fields: { status: 'doing' }, tags: [] })
store.setTagGroup('Cozy Mystery', 'Vibe')
store.setTagGroup('Rainy Day', 'Vibe')

await import('../src/server/main.ts')
