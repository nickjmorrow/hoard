import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, expect, it } from 'vitest'
import { Store } from '../../src/server/store.ts'
import { restoreInto } from './restore.ts'

let dir: string
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'hoard-restore-test-')) })
afterEach(() => rmSync(dir, { recursive: true, force: true }))

it('a backup that isn’t a usable store is refused before the live store is touched', () => {
  const live = new Store(join(dir, 'hoard.db'))
  live.createTitle({ name: 'Keep me', type: 'movie', fields: {}, tags: [] })
  live.close()
  const bad = join(dir, 'not-a-store.db')
  writeFileSync(bad, 'this is not a sqlite database at all, just some text that is long enough to look like a file')

  expect(() => restoreInto(dir, bad)).toThrow()

  expect(new Store(join(dir, 'hoard.db')).listTitles().map((t) => t.name)).toEqual(['Keep me'])
  expect(readdirSync(dir).filter((n) => n.includes('before-restore') || n.includes('restoring'))).toEqual([])
})

it('restores the backup and keeps the old store whole, including edits not yet checkpointed', () => {
  const backup = join(dir, 'backup.db')
  new Store(':memory:').backupTo(backup)
  // A server killed mid-run: its newest edits are still only in the -wal file.
  const storeModule = join(import.meta.dirname, '../../src/server/store.ts')
  const script = `
    const { Store } = await import(${JSON.stringify(storeModule)})
    new Store(${JSON.stringify(join(dir, 'hoard.db'))}).createTitle({ name: 'Newest edit', type: 'movie', fields: {}, tags: [] })
    process.kill(process.pid, 'SIGKILL')`
  try {
    execFileSync(process.execPath, ['--input-type=module', '-e', script], { stdio: 'ignore' })
  } catch { /* killed on purpose */ }
  expect(existsSync(join(dir, 'hoard.db-wal'))).toBe(true)

  const { kept, titles } = restoreInto(dir, backup)

  expect(titles).toBe(0)
  expect(new Store(join(dir, 'hoard.db')).listTitles()).toEqual([])
  expect(new Store(kept).listTitles().map((t) => t.name)).toEqual(['Newest edit'])
})
