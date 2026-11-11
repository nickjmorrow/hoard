// Daily copies of Hoard's store, kept next to it. A copy is written under a `.part` name and
// renamed when whole, so a crash or a full disk never leaves a half-written file that counts as a backup.

import { mkdirSync, readdirSync, renameSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import type { Store } from './store.ts'

export const BACKUPS_KEPT = 30
export const CHECK_EVERY_MS = 60 * 60_000
const DAY_MS = 24 * 60 * 60_000

// Only plain daily backups: a hand-made copy such as `hoard-before-import-….db` is never pruned.
const BACKUP_NAME = /^hoard-(\d{4})-(\d{2})-(\d{2})T(\d{2})(\d{2})\.db$/

function backupName(now: number): string {
  const iso = new Date(now).toISOString()
  return `hoard-${iso.slice(0, 10)}T${iso.slice(11, 13)}${iso.slice(14, 16)}.db`
}

function takenAt(name: string): number {
  const [, y, mo, d, h, mi] = BACKUP_NAME.exec(name)!.map(Number) as [number, number, number, number, number, number]
  return Date.UTC(y, mo - 1, d, h, mi)
}

/**
 * Write a backup into `dir` when the newest one is a day old or there is none; keep the newest
 * BACKUPS_KEPT. Returns the new file's path, or null when none was due.
 */
export function backupIfDue(store: Store, dir: string, now: number = Date.now()): string | null {
  mkdirSync(dir, { recursive: true })
  const files = readdirSync(dir)
  for (const leftover of files.filter((n) => n.endsWith('.db.part'))) rmSync(join(dir, leftover), { force: true })
  const backups = files.filter((n) => BACKUP_NAME.test(n)).sort()
  const newest = backups.at(-1)
  if (newest && now - takenAt(newest) < DAY_MS) return null

  const path = join(dir, backupName(now))
  store.backupTo(`${path}.part`)
  renameSync(`${path}.part`, path)
  for (const old of [...backups, backupName(now)].sort().slice(0, -BACKUPS_KEPT)) rmSync(join(dir, old), { force: true })
  return path
}

/** Back up now if due, then check again every hour. A failure is logged and never stops the server. */
export function startBackups(store: Store, dir: string): void {
  const run = () => {
    try {
      const path = backupIfDue(store, dir)
      if (path) console.log(`hoard: backed up to ${path}`)
    } catch (err) {
      console.error(`hoard: backup failed: ${err instanceof Error ? err.message : String(err)}`)
    }
  }
  run()
  setInterval(run, CHECK_EVERY_MS).unref()
}
