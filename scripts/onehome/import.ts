// The one-time import: copies every Hoard title page in Grimoire (fields, tags, notes, dates) and
// every tag group into Hoard's store. It only reads Grimoire. Titles keep their page id and dates.
//
//   node scripts/onehome/import.ts            # dry run: what would be copied, what skipped and why
//   node scripts/onehome/import.ts --apply    # copy them (after saving a copy of the store)
//
// Run on the server with GRIMOIRE_GRAPH and HOARD_DATA set as the server uses them, with the service
// stopped. Run again, it adds only what's missing.

import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { serverConfig } from '../../src/server/config.ts'
import { Grimoire } from '../../src/server/grimoire.ts'
import type { TitleDetail } from '../../src/server/model.ts'
import { Store } from '../../src/server/store.ts'
import { isHoardRunning } from '../lib/running.ts'
import { planImport } from './plan.ts'

const apply = process.argv.includes('--apply')
if (!process.env.GRIMOIRE_GRAPH) {
  console.error('GRIMOIRE_GRAPH is not set: point it at the Grimoire graph directory')
  process.exit(1)
}
const { port, dataDir } = serverConfig(process.env)
if (apply) {
  if (await isHoardRunning(port)) {
    console.error(`Hoard is running on port ${port}. Stop the service first, then run this again.`)
    process.exit(1)
  }
}

const grimoire = new Grimoire()
const store = new Store(join(dataDir, 'hoard.db'))

const listed = await grimoire.listTitles()
const pages: TitleDetail[] = []
const unreadable: string[] = []
for (const t of listed) {
  const page = await grimoire.getTitle(t.pageId)
  if (page) pages.push(page)
  else unreadable.push(t.pageTitle)
}
const notTitles = await grimoire.skippedPages()
const groups = (await grimoire.listTags()).filter((t) => t.group)
const before = store.listTitles()
const { add, skip } = planImport(pages, before)
const newGroups = groups.filter((g) => !store.listTags().some((t) => t.title.toLowerCase() === g.title.toLowerCase() && t.group))

const count = (items: string[]) => Object.entries(items.reduce<Record<string, number>>((m, k) => ({ ...m, [k]: (m[k] ?? 0) + 1 }), {}))
  .map(([k, n]) => `${n} ${k}`).join(', ')
console.log(`Read ${pages.length} title pages from Grimoire; the store already holds ${before.length} titles.`)
console.log(`To add: ${add.length} (${count(add.map((t) => t.type))}; ${count(add.map((t) => t.fields.status ?? 'want'))}); ${add.reduce((n, t) => n + t.notes.length, 0)} notes on ${add.filter((t) => t.notes.length).length} of them.`)
console.log(`Skipped: ${skip.length}`)
for (const s of skip) {
  const p = s.page
  const carried = p ? `  [page had: ${p.status}${p.rating !== undefined ? `, rated ${p.rating}` : ''}, ${p.tags} tags, ${p.notes} notes — not copied]` : ''
  console.log(`  ${s.pageTitle} — ${s.reason}${carried}`)
}
if (notTitles.length || unreadable.length) {
  console.log(`NOT imported, and not a title Hoard can read (${notTitles.length + unreadable.length}); look at these in Grimoire:`)
  for (const t of [...notTitles, ...unreadable]) console.log(`  ${t}`)
}
console.log(`Tag groups to copy: ${newGroups.length}${newGroups.length ? ` (${newGroups.map((g) => `${g.title} → ${g.group}`).join(', ')})` : ''}`)
const byDate = [...add].sort((a, b) => a.createdAt - b.createdAt)
console.log(byDate.length > 10 ? 'Oldest and newest by added date:' : 'By added date:')
for (const t of byDate.length > 10 ? [...byDate.slice(0, 5), ...byDate.slice(-5)] : byDate) console.log(`  ${new Date(t.createdAt).toISOString().slice(0, 10)}  ${t.name}`)

if (!apply) {
  console.log('\nDry run. Nothing was changed. Run with --apply to copy these into the store.')
  process.exit(0)
}

if (add.length === 0 && newGroups.length === 0) {
  console.log('\nNothing to copy: the store already has everything.')
  process.exit(0)
}

const stamp = new Date().toISOString().replace(/[-:]/g, '').slice(0, 15)
const backups = join(dataDir, 'backups')
mkdirSync(backups, { recursive: true })
const saved = join(backups, `hoard-before-import-${stamp}.db`)
store.backupTo(saved)
console.log(`\nSaved a copy of the store first: ${saved}`)

let added = 0
for (const t of add) {
  try {
    if (store.importTitle(t) === 'added') added++
  } catch (err) {
    console.error(`FAILED ${t.name}: ${err instanceof Error ? err.message : String(err)}`)
  }
}
for (const g of newGroups) store.setTagGroup(g.title, g.group!)

const after = store.listTitles().length
console.log(`Imported ${added} of ${add.length}; the store now holds ${after} titles (was ${before.length}).`)
if (after !== before.length + add.length) {
  console.error(`Expected ${before.length + add.length}. Something didn't copy; the saved copy above is the way back (scripts/backup/restore.ts).`)
  process.exit(1)
}
