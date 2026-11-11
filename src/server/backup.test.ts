import { mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { backupIfDue, BACKUPS_KEPT, startBackups } from './backup.ts'
import { Store } from './store.ts'

const HOUR = 3_600_000
const T0 = Date.UTC(2026, 9, 21, 12, 0)

let dir: string
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'hoard-backup-test-')) })
afterEach(() => { vi.restoreAllMocks(); rmSync(dir, { recursive: true, force: true }) })

const names = () => readdirSync(dir).sort()

describe('backupIfDue', () => {
  it('a backup opens as a store with the same titles and tag groups', () => {
    const store = new Store(':memory:')
    store.createTitle({ name: 'Supper Club', type: 'movie', fields: { rating: '4' }, tags: ['Cozy Mystery'] })
    store.setTagGroup('Cozy Mystery', 'Vibe')

    const path = backupIfDue(store, dir, T0)!
    expect(path).toBe(join(dir, 'hoard-2026-10-21T1200.db'))

    const copy = new Store(path)
    expect(copy.listTitles().map((t) => [t.name, t.rating])).toEqual([['Supper Club', 4]])
    expect(copy.listTags()).toEqual([{ title: 'Cozy Mystery', group: 'Vibe', count: 1 }])
  })

  it('no backup again within 24 hours; one at 24 hours', () => {
    const store = new Store(':memory:')
    expect(backupIfDue(store, dir, T0)).not.toBeNull()
    expect(backupIfDue(store, dir, T0 + 24 * HOUR - 60_000)).toBeNull()
    expect(backupIfDue(store, dir, T0 + 24 * HOUR)).toBe(join(dir, 'hoard-2026-10-22T1200.db'))
    expect(names().filter((n) => n.endsWith('.db'))).toHaveLength(2)
  })

  it('keeps the newest 30', () => {
    const store = new Store(':memory:')
    for (let day = 0; day < BACKUPS_KEPT + 3; day++) backupIfDue(store, dir, T0 + day * 24 * HOUR)
    const kept = names().filter((n) => n.endsWith('.db'))
    expect(kept).toHaveLength(BACKUPS_KEPT)
    expect(kept[0]).toBe('hoard-2026-10-24T1200.db')
  })

  it('a leftover .part file is not counted as a backup', () => {
    writeFileSync(join(dir, 'hoard-2026-10-21T1100.db.part'), 'half')
    const store = new Store(':memory:')
    expect(backupIfDue(store, dir, T0)).toBe(join(dir, 'hoard-2026-10-21T1200.db'))
    expect(names()).toEqual(['hoard-2026-10-21T1200.db'])
  })

  it('other files in the folder, like a before-import copy, are neither counted nor pruned', () => {
    writeFileSync(join(dir, 'hoard-before-import-2026-10-21T1130.db'), 'x')
    const store = new Store(':memory:')
    for (let day = 0; day < BACKUPS_KEPT + 2; day++) backupIfDue(store, dir, T0 + day * 24 * HOUR)
    expect(names()).toContain('hoard-before-import-2026-10-21T1130.db')
  })
})

describe('startBackups', () => {
  it('logs and carries on when the directory can’t be written', () => {
    const blocker = join(dir, 'not-a-folder')
    writeFileSync(blocker, 'a file where the folder should be')
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})
    expect(() => startBackups(new Store(':memory:'), blocker)).not.toThrow()
    expect(log.mock.calls[0]![0]).toMatch(/^hoard: backup failed: /)
  })
})
