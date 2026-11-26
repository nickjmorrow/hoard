// "Suggest more like this": Claude reads a set of titles (a tag, a person, a pick) and proposes new ones.
// The server runs headless Claude Code (`claude -p`) in its user's login session, so it uses that
// user's Claude account. Every suggestion is checked against OMDb before it's kept.

import { spawn } from 'node:child_process'
import { mkdtempSync, readdirSync, statSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import type { DetailKey, FieldKey, MediaType, Title } from '../shared/title.ts'
import { normalizeName } from './enricher.ts'
import { LookupUnavailableError } from './lookupError.ts'
import type { Lookup, LookupResult } from './ports.ts'
import type { Store, Suggestion } from './store.ts'

/** `have`: a title already in the library that fits with the seeds, rather than a new one. */
export interface RawSuggestion { name: string; year?: number; type: MediaType; why: string; have?: boolean }

/** A title already in the library that Claude says fits with the seeds, and why. */
export interface OwnedPick { pageId: string; why: string }

/** How many owned titles to ask for alongside the new ones (an ask or For You gets more). */
export const OWNED_PICKS = 8
export const OWNED_PICKS_WIDE = 12

/** The label For You runs carry, in the inbox and on the run. */
export const FOR_YOU = 'For you'

/** For You's seeds: what they finished recently and liked, newest first. */
export function recentLikes(library: Title[], max = 15): Title[] {
  const liked = library
    .filter((t) => t.type !== 'game' && t.status === 'done' && (t.rating ?? 0) >= 4)
    .sort((a, b) => (b.finished ?? '').localeCompare(a.finished ?? ''))
  return liked.slice(0, max)
}

/** Turns a prompt into suggestions. The real one runs Claude; tests pass a fake. */
export interface Suggester {
  suggest(prompt: string): Promise<RawSuggestion[]>
}

export class SuggestError extends Error {}

export interface SuggestRequest {
  /**
   * seeds: more like a tag, person or pick (the default). ask: a question in their own words, answered from
   * the whole library. forYou: a fresh batch from what they watched and liked lately.
   */
  mode?: 'seeds' | 'ask' | 'forYou'
  /** What the seeds are, for the inbox and the prompt: a tag name, a person, titles listed, or the question. */
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

/** One library line for an ask or For You: enough for Claude to pick owned titles by mood. */
function libraryLine(t: Title): string {
  const bits = [`${t.name}${t.year ? ` (${t.year})` : ''}`, t.type === 'show' ? 'show' : 'movie']
  if (t.tags.length) bits.push(`tags: ${t.tags.join(', ')}`)
  if (t.genre?.length) bits.push(t.genre.join('/'))
  if (t.status === 'done') bits.push(t.rating ? `watched, ${t.rating}/5` : 'watched')
  else if (t.status === 'dropped') bits.push('gave up')
  else if (t.status === 'doing') bits.push('watching now')
  else bits.push('not watched yet')
  return `- ${bits.join('; ')}`
}

const label = (x: { name: string; year?: number }) => `${x.name}${x.year ? ` (${x.year})` : ''}`
const tidy = (lines: string[]) => lines.filter((line, i, all) => line !== '' || all[i - 1] !== '').join('\n')
const replyFormat = [
  'Reply with only a JSON array, no prose and no code fence:',
  '[{"name": "Title", "year": 2019, "type": "movie" or "show", "why": "One sentence.", "have": false}]',
]

/** An ask or For You: the whole library as context, then the question (or their recent likes). */
function buildWidePrompt(req: SuggestRequest, library: Title[], passed: Suggestion[], who: string): string {
  const kind = req.type === 'show' ? 'TV shows' : req.type === 'movie' ? 'movies' : 'movies or TV shows'
  const shelf = library.filter((t) => t.type !== 'game')
  const ask = req.mode === 'ask'
  return tidy([
    `You recommend ${kind} to ${who}, who keeps a careful list of what they watch. Their whole library, with their tags and ratings:`,
    ...shelf.map(libraryLine),
    '',
    ask
      ? `They asked: "${req.source}"${req.prompt?.trim() ? `, and added: ${req.prompt.trim()}` : ''}`
      : 'They want a fresh batch based on their taste, above all what they watched and liked lately:',
    ...(ask ? [] : req.seeds.map(describe)),
    !ask && req.prompt?.trim() ? `What they asked for: ${req.prompt.trim()}` : '',
    '',
    ask
      ? `First pick up to ${OWNED_PICKS_WIDE} titles from their library that answer it best, best first. Mark those with "have": true.`
      : `First pick up to ${OWNED_PICKS_WIDE} titles from their library they haven't watched yet that they'd likely enjoy most right now. Mark those with "have": true.`,
    `Then suggest ${req.count} ${kind} they don't have${ask ? ' that answer it' : ' that fit their recent taste'}. Real, released titles only. Mix the well known with the overlooked.`,
    'For each, one sentence of why, tied to their titles or their words. No spoilers.',
    passed.length ? `They turned these down; never suggest them: ${passed.map(label).join('; ')}` : '',
    '',
    ...replyFormat,
  ])
}

/** The whole prompt: the seeds, the viewer's taste, what to avoid, and the reply format. */
export function buildPrompt(req: SuggestRequest, library: Title[], passed: Suggestion[], who = viewerName()): string {
  if (req.mode === 'ask' || req.mode === 'forYou') return buildWidePrompt(req, library, passed, who)
  const kind = req.type === 'show' ? 'TV shows' : req.type === 'movie' ? 'movies' : 'movies or TV shows'
  const favorites = library
    .filter((t) => t.status === 'done' && (t.rating ?? 0) >= 5 && t.type !== 'game' && !req.seeds.includes(t))
    .slice(0, 25)
  const owned = library.filter((t) => t.type !== 'game').map(label)
  return tidy([
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
    'They already have all of these, so never suggest them as new:',
    owned.join('; '),
    passed.length ? `They turned these down; never suggest them: ${passed.map(label).join('; ')}` : '',
    '',
    `Also pick up to ${OWNED_PICKS} titles from the list they already have (other than the ones they grouped) that belong with "${req.source}", so they see what they own that fits. Mark those with "have": true and give the same one sentence of why.`,
    '',
    ...replyFormat,
  ])
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
    if (name) out.push({ name, type, why, ...(year ? { year } : {}), ...(r.have === true ? { have: true } : {}) })
  }
  return out
}

/**
 * Checks each suggestion against OMDb and drops anything already in the library, passed on, or that can't be found.
 * If OMDb is out (its daily limit), the rest are kept unchecked rather than lost: they get their details once added.
 */
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
  const knownNames = new Set([...library, ...earlier].map((t) => `${normalizeName(t.name)}|${t.year ?? ''}`))
  const out: Omit<Suggestion, 'id' | 'state' | 'createdAt' | 'source' | 'tag'>[] = []
  let lookupDown = false
  for (const s of raw) {
    const nameKey = `${normalizeName(s.name)}|${s.year ?? ''}`
    if (knownNames.has(nameKey)) continue
    let results: LookupResult[] = []
    if (!lookupDown) {
      try {
        results = await lookup.search(s.type, s.name)
      } catch (e) {
        if (!(e instanceof LookupUnavailableError)) throw e
        lookupDown = true
      }
    }
    if (lookupDown) {
      knownNames.add(nameKey)
      out.push({ name: s.name, type: s.type, why: s.why, fields: s.year ? { year: String(s.year) } : {}, ...(s.year ? { year: s.year } : {}) })
      continue
    }
    const want = normalizeName(s.name)
    const hits = results.filter((r) => normalizeName(r.name) === want && (s.year === undefined || (r.year !== undefined && Math.abs(r.year - s.year) <= 1)))
    const hit = hits[0]
    if (!hit || known.has(hit.id.toLowerCase())) continue
    known.add(hit.id.toLowerCase())
    let details: Partial<Record<DetailKey, string>> = {}
    try {
      details = await lookup.details(s.type, hit.id)
    } catch (e) {
      if (!(e instanceof LookupUnavailableError)) throw e
      lookupDown = true
    }
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

/**
 * Suggestions saved unchecked while OMDb was out get their details (RT, runtime, poster) once it's back:
 * up to `max` per pass, stopping when OMDb is out again. One OMDb can't find stays as it was.
 */
export async function checkUnverified(store: Store, lookup: Lookup, max = 20): Promise<number> {
  let done = 0
  for (const s of store.suggestions('new').filter((x) => !x.imdb).slice(0, max)) {
    try {
      const want = normalizeName(s.name)
      const hits = (await lookup.search(s.type, s.name))
        .filter((r) => normalizeName(r.name) === want && (s.year === undefined || (r.year !== undefined && Math.abs(r.year - s.year) <= 1)))
      const hit = hits[0]
      if (!hit) continue
      const { poster, ...fields } = await lookup.details(s.type, hit.id)
      if (poster) store.setPoster(hit.id, poster)
      store.updateSuggestion({
        ...s,
        name: hit.name,
        imdb: hit.id,
        fields: { ...s.fields, imdb: hit.id, ...(fields as Partial<Record<FieldKey, string>>) },
        ...(hit.year ? { year: hit.year } : {}),
        ...(poster ? { poster } : {}),
      })
      done++
    } catch (e) {
      if (e instanceof LookupUnavailableError) break
      throw e
    }
  }
  return done
}

/** The owned titles Claude picked, matched to the library by name (and year when given); never a seed, never twice. */
export function matchOwned(raw: RawSuggestion[], library: Title[], seeds: Title[], max = OWNED_PICKS): OwnedPick[] {
  const seedIds = new Set(seeds.map((t) => t.pageId))
  const out: OwnedPick[] = []
  for (const r of raw) {
    const want = normalizeName(r.name)
    const named = library.filter((t) => t.type !== 'game' && normalizeName(t.name) === want)
    const t = named.find((x) => r.year === undefined || x.year === r.year) ?? (named.length === 1 ? named[0] : undefined)
    if (!t || seedIds.has(t.pageId) || out.some((o) => o.pageId === t.pageId)) continue
    out.push({ pageId: t.pageId, why: r.why })
  }
  return out.slice(0, max)
}

/** The full round trip: prompt, Claude, OMDb, the store. Returns the new suggestions and the owned titles that fit. */
export async function runSuggest(
  req: SuggestRequest,
  deps: { suggester: Suggester; lookup: Lookup; store: Store; library: Title[] },
): Promise<{ suggestions: Suggestion[]; owned: OwnedPick[] }> {
  const earlier = deps.store.suggestions()
  const passed = earlier.filter((s) => s.state === 'passed')
  const raw = await deps.suggester.suggest(buildPrompt(req, deps.library, passed))
  const verified = await verifySuggestions(raw.filter((r) => !r.have), deps.lookup, deps.library, earlier)
  for (const s of verified) if (s.poster && s.imdb) deps.store.setPoster(s.imdb, s.poster)
  const suggestions = deps.store.addSuggestions(verified.map((s) => ({ ...s, source: req.source, ...(req.tag ? { tag: req.tag } : {}) })))
  const wide = req.mode === 'ask' || req.mode === 'forYou'
  // For You's owned picks are what to watch next, so only titles not watched yet.
  const pickable = req.mode === 'forYou' ? deps.library.filter((t) => t.status === 'want' || t.status === 'doing') : deps.library
  const owned = matchOwned(raw.filter((r) => r.have), pickable, req.mode === 'ask' ? [] : req.seeds, wide ? OWNED_PICKS_WIDE : OWNED_PICKS)
  return { suggestions, owned }
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

/** Runs `claude -p` with no tools, in an empty folder so no project settings load, and returns its reply. */
export function runClaude(prompt: string, opts: { model: string; timeoutMs: number }): Promise<string> {
  const cwd = mkdtempSync(join(tmpdir(), 'hoard-claude-'))
  return new Promise((resolve, reject) => {
    const child = spawn(claudeBin(), [
      '-p', '--output-format', 'json', '--model', opts.model,
      '--tools', '', '--permission-mode', 'dontAsk', '--setting-sources', 'project',
    ], { cwd, stdio: ['pipe', 'pipe', 'pipe'] })
    let out = ''
    let err = ''
    const timer = setTimeout(() => {
      child.kill('SIGTERM')
      reject(new SuggestError('Claude took too long to answer'))
    }, opts.timeoutMs)
    child.stdout.on('data', (d) => (out += d))
    child.stderr.on('data', (d) => (err += d))
    child.on('error', (e) => { clearTimeout(timer); reject(new SuggestError(`couldn't start Claude: ${e.message}`)) })
    child.on('close', (code) => {
      clearTimeout(timer)
      let reply: { result?: unknown; is_error?: unknown } | null = null
      try { reply = JSON.parse(out) } catch { /* reported below */ }
      if (code !== 0 || !reply || reply.is_error === true || typeof reply.result !== 'string') {
        const why = typeof reply?.result === 'string' ? reply.result : err.trim() || `exit ${code}`
        reject(new SuggestError(`Claude couldn't answer: ${why.slice(0, 300)}`))
        return
      }
      resolve(reply.result)
    })
    child.stdin.end(prompt)
  })
}

export class ClaudeSuggester implements Suggester {
  private model: string
  private timeoutMs: number

  constructor(opts: { model?: string; timeoutMs?: number } = {}) {
    this.model = opts.model ?? process.env.HOARD_CLAUDE_MODEL ?? 'opus'
    this.timeoutMs = opts.timeoutMs ?? 240_000
  }

  async suggest(prompt: string): Promise<RawSuggestion[]> {
    return parseSuggestions(await runClaude(prompt, { model: this.model, timeoutMs: this.timeoutMs }))
  }
}
