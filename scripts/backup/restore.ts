// Puts a backup back as Hoard's store. Stop the service first; the old store is kept beside it.
//
//   node scripts/backup/restore.ts <backup-file>
//
// Run on the server with HOARD_DATA set as the server uses it (the default is
// ~/Library/Application Support/Hoard).

import { copyFileSync, existsSync, renameSync, rmSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { serverConfig } from '../../src/server/config.ts'
import { Store } from '../../src/server/store.ts'
import { isHoardRunning } from '../lib/running.ts'

/**
 * Replace `<dataDir>/hoard.db` with the backup. The old store moves to `hoard.db.before-restore-<time>`,
 * its -wal and -shm files renamed to match, so it still opens with every edit it had. The backup is
 * opened and counted first: a file that isn't a usable store is refused before the live store is touched.
 */
export function restoreInto(dataDir: string, backup: string): { kept: string; titles: number } {
  const db = join(dataDir, 'hoard.db')
  const kept = `${db}.before-restore-${new Date().toISOString().replace(/[-:]/g, '').slice(0, 13)}`
  const staged = `${db}.restoring`
  copyFileSync(resolve(backup), staged)
  let titles: number
  try {
    const check = new Store(staged)
    titles = check.listTitles().length
    check.close()
  } catch (err) {
    for (const suffix of ['', '-wal', '-shm']) rmSync(staged + suffix, { force: true })
    throw new Error(`${backup} isn't a usable Hoard store (${err instanceof Error ? err.message : String(err)}); nothing was changed.`)
  }
  for (const suffix of ['', '-wal', '-shm']) {
    if (existsSync(db + suffix)) renameSync(db + suffix, kept + suffix)
  }
  renameSync(staged, db)
  return { kept, titles }
}

if (import.meta.main) {
  const source = process.argv[2]
  if (!source || !existsSync(source)) {
    console.error('usage: node scripts/backup/restore.ts <backup-file>')
    process.exit(1)
  }
  const { port, dataDir } = serverConfig(process.env)
  if (await isHoardRunning(port)) {
    console.error(`Hoard is running on port ${port}. Stop the service first (launchctl bootout gui/$(id -u)/com.nicholai.hoard), then run this again.`)
    process.exit(1)
  }
  let restored: ReturnType<typeof restoreInto>
  try {
    restored = restoreInto(dataDir, source)
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err))
    process.exit(1)
  }
  const { kept, titles } = restored
  console.log(`Restored ${titles} titles from ${source}. The previous store is kept as ${kept}.`)
}
