import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect, it } from 'vitest'

const here = import.meta.dirname

// Source files the server and client are built from: not tests, not the throwaway-graph helper they use.
function sources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const path = join(dir, e.name)
    if (e.isDirectory()) return sources(path)
    return /\.(ts|tsx)$/.test(e.name) && !/\.test\.tsx?$/.test(e.name) && e.name !== 'testGraph.ts' ? [path] : []
  })
}

it('only the import script uses the Grimoire adapter: nothing under src/ imports it', () => {
  const importers = sources(join(here, '..'))
    .filter((f) => !/\/server\/(grimoire|grim)\.ts$/.test(f))
    .filter((f) => /from '\.{1,2}\/(?:server\/)?grim(oire)?\.ts'/.test(readFileSync(f, 'utf8')))
  expect(importers).toEqual([])
})

it('scripts don’t reach Grimoire either: only the import reads it, through the adapter, and nothing runs grim directly', () => {
  const importers = (pattern: RegExp) => sources(join(here, '../../scripts'))
    .filter((f) => pattern.test(readFileSync(f, 'utf8')))
    .map((f) => f.slice(join(here, '../..').length + 1))
  expect(importers(/from '[./]+\/src\/server\/grimoire\.ts'/)).toEqual(['scripts/onehome/import.ts'])
  expect(importers(/from '[./]+\/src\/server\/grim\.ts'/)).toEqual([])
})

it('the Grimoire adapter only reads: every grim call in it is a query', () => {
  const code = readFileSync(join(here, 'grimoire.ts'), 'utf8')
  const subcommands = [...code.matchAll(/\bgrim\(\[\s*'([a-z-]+)'/g)].map((m) => m[1])
  expect(subcommands.length).toBeGreaterThan(0)
  expect(subcommands.filter((c) => c !== 'query')).toEqual([])
})
