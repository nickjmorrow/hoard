// "Suggest more like this": Claude reads a set of titles (a tag, a person, a pick) and proposes new ones.
// The server runs headless Claude Code (`claude -p`) in its user's login session, so it uses that
// user's Claude account. Every suggestion is checked against OMDb before it's kept.

import { spawn } from 'node:child_process'
import { mkdtempSync, readdirSync, statSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import type { DetailKey, FieldKey, MediaType, Title } from '../shared/title.ts'
import { normalizeName } from './enricher.ts'
import type { Lookup } from './ports.ts'
import type { Store, Suggestion } from './store.ts'

export interface RawSuggestion { name: string; year?: number; type: MediaType; why: string }

/** Turns a prompt into suggestions. The real one runs Claude; tests pass a fake. */
export interface Suggester {
  suggest(prompt: string): Promise<RawSuggestion[]>
}

export class SuggestError extends Error {}

export interface SuggestRequest {
  /** What the seeds are, for the inbox and the prompt: a tag name, a person, or titles listed. */
  source: string
  seeds: Title[]
  /** The tag kept suggestions get. */
  tag?: string
  /** Extra words from the user ("less gore", "something from the 70s"). */
  prompt?: string
  type?: MediaType
  count: number
}

function describe(t: Title): string {
  const bits = [`${t.name}${t.year ? ` (${t.year})` : ''}`, t.type === 'show' ? 'TV show' : 'movie']
  if (t.status === 'done') bits.push(t.rating ? `watched, rated ${t.rating}/5` : 'watched')
  else if (t.status === 'dropped') bits.push('gave up on it')
  else if (t.status === 'doing') bits.push('watching now')
  else bits.push('on the list, not watched yet')
  if (t.director?.length) bits.push(`directed by ${t.director.join(', ')}`)
  if (t.genre?.length) bits.push(t.genre.join('/'))
  const note = t.notesText.replace(/\s+/g, ' ').trim()
  if (note) bits.push(`note: "${note.slice(0, 200)}"`)
  return `- ${bits.join('; ')}`
}

/** Who the suggestions are for, by name in the prompt: HOARD_USER_NAME, else "someone". */
export function viewerName(env: Record<string, string | undefined> = process.env): string {
  return env.HOARD_USER_NAME?.trim() || 'someone'
}

/** The whole prompt: the seeds, the viewer's taste, what to avoid, and the reply format. */
export function buildPrompt(req: SuggestRequest, library: Title[], passed: Suggestion[], who = viewerName()): string {
  const kind = req.type === 'show' ? 'TV shows' : req.type === 'movie' ? 'movies' : 'movies or TV shows'
  const favorites = library
    .filter((t) => t.status === 'done' && (t.rating ?? 0) >= 5 && t.type !== 'game' && !req.seeds.includes(t))
    .slice(0, 25)
  const avoid = [
    ...library.filter((t) => t.type !== 'game').map((t) => `${t.name}${t.year ? ` (${t.year})` : ''}`),
    ...passed.map((s) => `${s.name}${s.year ? ` (${s.year})` : ''}`),
  ]
  return [
    `You recommend ${kind} to ${who}, who keeps a careful list of what they watch.`,
    '',
    `They grouped these as "${req.source}". Watched titles with high ratings matter most; unwatched ones show what they're drawn to; low ratings and dropped titles show what to steer away from.`,
    ...req.seeds.map(describe),
    '',
    favorites.length ? 'Other titles they loved, for their taste in general:' : '',
    ...favorites.map((t) => `- ${t.name}${t.year ? ` (${t.year})` : ''}`),
    '',
    req.prompt?.trim() ? `What they asked for: ${req.prompt.trim()}` : '',
    '',
    `Suggest ${req.count} ${kind} they don't already have that share what makes "${req.source}" work for them. Real, released titles only. Mix the well known with the overlooked.`,
    'For each, one sentence of why, naming what it has in common with their titles. No spoilers.',
    '',
    'They already have or turned down all of these, so never suggest them:',
    avoid.join('; '),
    '',
    'Reply with only a JSON array, no prose and no code fence:',
    '[{"name": "Title", "year": 2019, "type": "movie" or "show", "why": "One sentence."}]',
  ].filter((line, i, all) => line !== '' || all[i - 1] !== '').join('\n')
}

/** The JSON array in Claude's reply, tolerating a code fence or a sentence around it. */
export function parseSuggestions(text: string): RawSuggestion[] {
  const start = text.indexOf('[')
  const end = text.lastIndexOf(']')
  if (start === -1 || end <= start) throw new SuggestError('Claude didn\'t return a list of titles')
  let raw: unknown
  try {
    raw = JSON.parse(text.slice(start, end + 1))
  } catch {
    throw new SuggestError('Claude\'s list of titles wasn\'t valid JSON')
  }
  if (!Array.isArray(raw)) throw new SuggestError('Claude didn\'t return a list of titles')
  const out: RawSuggestion[] = []
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue
    const r = item as Record<string, unknown>
    const name = typeof r.name === 'string' ? r.name.trim() : ''
    const why = typeof r.why === 'string' ? r.why.trim() : ''
    const type: MediaType = r.type === 'show' ? 'show' : 'movie'
    const year = typeof r.year === 'number' && Number.isInteger(r.year) ? r.year : typeof r.year === 'string' && /^\d{4}$/.test(r.year) ? Number(r.year) : undefined
    if (name) out.push({ name, type, why, ...(year ? { year } : {}) })
  }
  return out
}

/** Checks each suggestion against OMDb and drops anything already in the library, passed on, or that can't be found. */
export async function verifySuggestions(
  raw: RawSuggestion[],
  lookup: Lookup,
  library: Title[],
  earlier: Suggestion[],
): Promise<Omit<Suggestion, 'id' | 'state' | 'createdAt' | 'source' | 'tag'>[]> {
  const known = new Set([
    ...library.flatMap((t) => (t.imdb ? [t.imdb.toLowerCase()] : [])),
    ...earlier.flatMap((s) => (s.imdb ? [s.imdb.toLowerCase()] : [])),
  ])
  const knownNames = new Set(library.map((t) => `${normalizeName(t.name)}|${t.year ?? ''}`))
  const out: Omit<Suggestion, 'id' | 'state' | 'createdAt' | 'source' | 'tag'>[] = []
  for (const s of raw) {
    if (knownNames.has(`${normalizeName(s.name)}|${s.year ?? ''}`)) continue
    const results = await lookup.search(s.type, s.name)
    const want = normalizeName(s.name)
    const hits = results.filter((r) => normalizeName(r.name) === want && (s.year === undefined || (r.year !== undefined && Math.abs(r.year - s.year) <= 1)))
    const hit = hits[0]
    if (!hit || known.has(hit.id.toLowerCase())) continue
    known.add(hit.id.toLowerCase())
    const details: Partial<Record<DetailKey, string>> = await lookup.details(s.type, hit.id)
    const { poster, ...fields } = details
    out.push({
      name: hit.name,
      type: s.type,
      imdb: hit.id,
      why: s.why,
      fields: { imdb: hit.id, ...(fields as Partial<Record<FieldKey, string>>) },
      ...(hit.year ? { year: hit.year } : {}),
      ...(poster ? { poster } : {}),
    })
  }
  return out
}

/** The full round trip: prompt, Claude, OMDb, the store. Returns the new suggestions. */
export async function runSuggest(
  req: SuggestRequest,
  deps: { suggester: Suggester; lookup: Lookup; store: Store; library: Title[] },
): Promise<Suggestion[]> {
  const earlier = deps.store.suggestions()
  const passed = earlier.filter((s) => s.state === 'passed')
  const raw = await deps.suggester.suggest(buildPrompt(req, deps.library, passed))
  const verified = await verifySuggestions(raw, deps.lookup, deps.library, earlier)
  for (const s of verified) if (s.poster && s.imdb) deps.store.setPoster(s.imdb, s.poster)
  return deps.store.addSuggestions(verified.map((s) => ({ ...s, source: req.source, ...(req.tag ? { tag: req.tag } : {}) })))
}

/** $CLAUDE_BIN, else the copy the Claude app keeps current (newest), else Homebrew's. */
export function claudeBin(home = homedir()): string {
  if (process.env.CLAUDE_BIN) return process.env.CLAUDE_BIN
  const base = join(home, 'Library/Application Support/Claude/claude-code')
  const found: { path: string; mtime: number }[] = []
  try {
    for (const version of readdirSync(base)) {
      for (const build of readdirSync(join(base, version))) {
        const path = join(base, version, build, 'claude.app/Contents/MacOS/claude')
        try { found.push({ path, mtime: statSync(path).mtimeMs }) } catch { /* not this one */ }
      }
    }
  } catch { /* no Claude app here */ }
  found.sort((a, b) => b.mtime - a.mtime)
  return found[0]?.path ?? '/opt/homebrew/bin/claude'
}

/** Runs `claude -p` with no tools, in an empty folder so no project settings load. */
export class ClaudeSuggester implements Suggester {
  private model: string
  private timeoutMs: number

  constructor(opts: { model?: string; timeoutMs?: number } = {}) {
    this.model = opts.model ?? process.env.HOARD_CLAUDE_MODEL ?? 'opus'
    this.timeoutMs = opts.timeoutMs ?? 240_000
  }

  suggest(prompt: string): Promise<RawSuggestion[]> {
    const cwd = mkdtempSync(join(tmpdir(), 'hoard-suggest-'))
    return new Promise((resolve, reject) => {
      const child = spawn(claudeBin(), [
        '-p', '--output-format', 'json', '--model', this.model,
        '--tools', '', '--permission-mode', 'dontAsk', '--setting-sources', 'project',
      ], { cwd, stdio: ['pipe', 'pipe', 'pipe'] })
      let out = ''
      let err = ''
      const timer = setTimeout(() => {
        child.kill('SIGTERM')
        reject(new SuggestError('Claude took too long to answer'))
      }, this.timeoutMs)
      child.stdout.on('data', (d) => (out += d))
      child.stderr.on('data', (d) => (err += d))
      child.on('error', (e) => { clearTimeout(timer); reject(new SuggestError(`couldn't start Claude: ${e.message}`)) })
      child.on('close', (code) => {
        clearTimeout(timer)
        let reply: { result?: unknown; is_error?: unknown } | null = null
        try { reply = JSON.parse(out) } catch { /* reported below */ }
        if (code !== 0 || !reply || reply.is_error === true || typeof reply.result !== 'string') {
          const why = typeof reply?.result === 'string' ? reply.result : err.trim() || `exit ${code}`
          reject(new SuggestError(`Claude couldn't suggest anything: ${why.slice(0, 300)}`))
          return
        }
        try { resolve(parseSuggestions(reply.result)) } catch (e) { reject(e) }
      })
      child.stdin.end(prompt)
    })
  }
}
