// What a risky command would change, measured without running it. Returns facts, never prose:
// the words live in messages.ts. It never sees `$`: register.tsx hands it a Probe of literal
// engine calls, so it is tested with a plain object.

import type { GitRisk, MigrationRisk, Risk } from './classify'
import { type InstallRisk, npmPackageName } from './installs'
import { baseName, dirOf, hasWildcards, positionals, relativeTo, resolvePath, wildcardToRegex } from './shell'

export type Stat = { kind: string; size: number; isLink: boolean }
export type Entry = Stat & { name: string }
export type Run = { exitCode: number; stdout: string; stderr: string }

/** What measuring needs from the engine. `stat` and `list` give null on a missing path; `run` never throws. */
export type Probe = {
  windows: boolean
  home: string
  now(): Promise<number>
  stat(path: string): Promise<Stat | null>
  list(path: string): Promise<Entry[] | null>
  run(argv: string[], options: { cwd?: string; timeoutMs: number; env?: Record<string, string> }): Promise<Run>
}

export type Facts =
  | { kind: 'unmeasured'; reason: 'missing-dir' | 'error'; detail: string }
  | { kind: 'delete'; targets: string[]; found: number; files: number; bytes: number; sample: string[]; truncated: boolean }
  | { kind: 'clean'; ok: boolean; paths: string[]; error: string }
  | { kind: 'discard'; ok: boolean; files: string[]; commits: string[]; shortstat: string; error: string }
  | { kind: 'push'; target: string; source: string; known: boolean; commits: string[] }
  | { kind: 'migrate'; argv: string[] | null; ok: boolean; pending: string[] }
  | { kind: 'install'; installed: Record<string, string> | null }

/** How many paths a list keeps; the rest is only counted. */
export const LIST_MAX = 10
const WALK_MAX = 20_000
const WALK_MS = 8_000
/** git in English whatever the person's locale: its output is parsed. */
const GIT_ENV = { LC_ALL: 'C', LANGUAGE: 'C' }

/** Never throws: what could not be measured comes back as `unmeasured`. */
export async function measure(risk: Risk, cwd: string, probe: Probe): Promise<Facts> {
  try {
    if (risk.kind === 'install') return await measureInstall(risk, probe)
    if (risk.kind === 'delete') return await measureDelete(risk.targets, cwd, probe)
    if (risk.kind === 'migrate') return await measureMigration(risk, cwd, probe)
    if (risk.op === 'push-force') return await measurePush(risk, cwd, probe)
    if (risk.op === 'clean') return await measureClean(risk, cwd, probe)
    return await measureDiscard(risk, cwd, probe)
  } catch (error) {
    return { kind: 'unmeasured', reason: 'error', detail: String(error instanceof Error ? error.message : error).slice(0, 200) }
  }
}

// ---------------------------------------------------------------------------
// Deletes

/** The paths a target names; with wildcards, only in its last part. */
async function expand(target: string, cwd: string, probe: Probe): Promise<string[]> {
  const path = resolvePath(cwd, target, probe.home)
  if (!hasWildcards(path)) return (await probe.stat(path)) ? [path] : []
  const parent = dirOf(path)
  if (hasWildcards(parent)) return []
  const pattern = wildcardToRegex(baseName(path))
  const entries = (await probe.list(parent)) ?? []
  return entries.filter(e => pattern.test(e.name)).map(e => `${parent.replace(/\/$/, '')}/${e.name}`)
}

async function measureDelete(targets: string[], cwd: string, probe: Probe): Promise<Facts> {
  const deadline = (await probe.now()) + WALK_MS
  const sample: string[] = []
  let files = 0
  let bytes = 0
  let found = 0
  let truncated = false
  const count = (path: string, size: number) => {
    files++
    bytes += size
    if (sample.length < LIST_MAX) sample.push(relativeTo(cwd, path))
    if (files >= WALK_MAX) truncated = true
  }
  for (const target of targets) {
    for (const path of await expand(target, cwd, probe)) {
      if (truncated) break
      found++
      const st = await probe.stat(path)
      if (st === null) continue
      if (st.kind !== 'dir' || st.isLink) {
        count(path, st.size)
        continue
      }
      let level = [path]
      while (level.length > 0 && !truncated) {
        const below: string[] = []
        for (const dir of level) {
          for (const e of (await probe.list(dir)) ?? []) {
            const child = `${dir.replace(/\/$/, '')}/${e.name}`
            if (e.kind === 'dir' && !e.isLink) below.push(child)
            else count(child, e.size)
            if (truncated) break
          }
          if (truncated || (await probe.now()) > deadline) {
            truncated = true
            break
          }
        }
        level = below
      }
    }
  }
  return { kind: 'delete', targets, found, files, bytes, sample, truncated }
}

// ---------------------------------------------------------------------------
// git

const git = (probe: Probe, cwd: string, args: string[]) => probe.run(['git', ...args], { cwd, timeoutMs: 15_000, env: GIT_ENV })

/** `git clean` arguments for a dry run: `-n` is added, and `-f`, `-i` and `-q` would change it. */
export function cleanDryRunArgs(args: string[]): string[] {
  const options: string[] = []
  const paths: string[] = []
  for (let i = 0; i < args.length; i++) {
    const a = args[i] ?? ''
    if (a === '--') {
      paths.push(...args.slice(i + 1))
      break
    }
    if (a === '-e' || a === '--exclude') {
      options.push(a, args[i + 1] ?? '')
      i++
    } else if (a.startsWith('--exclude=') || /^-e./.test(a)) options.push(a)
    else if (/^-[a-zA-Z]+$/.test(a)) {
      const kept = a.replace(/[finq]/g, '')
      if (kept !== '-') options.push(kept)
    } else if (!a.startsWith('-')) paths.push(a)
  }
  return ['clean', '-n', ...options, '--', ...paths]
}

async function measureClean(risk: GitRisk, cwd: string, probe: Probe): Promise<Facts> {
  const run = await git(probe, cwd, cleanDryRunArgs(risk.args))
  if (run.exitCode !== 0) return { kind: 'clean', ok: false, paths: [], error: run.stderr.trim().slice(0, 200) }
  const paths = run.stdout
    .split('\n')
    .filter(l => l.startsWith('Would remove '))
    .map(l => l.slice('Would remove '.length))
  return { kind: 'clean', ok: true, paths, error: '' }
}

/** The commit `git reset --hard` moves to (HEAD when it names none). */
export function resetTarget(args: string[]): string {
  const end = args.indexOf('--')
  return (end < 0 ? args : args.slice(0, end)).find(a => !a.startsWith('-')) ?? 'HEAD'
}

async function measureDiscard(risk: GitRisk, cwd: string, probe: Probe): Promise<Facts> {
  const status = await git(probe, cwd, ['status', '--porcelain'])
  if (status.exitCode !== 0) return { kind: 'discard', ok: false, files: [], commits: [], shortstat: '', error: status.stderr.trim().slice(0, 200) }
  const rows = status.stdout.split('\n').filter(l => l.length > 3 && !l.startsWith('??'))
  const reset = risk.op === 'reset-hard'
  // reset --hard loses staged and unstaged changes; checkout -- . only unstaged ones.
  const files = (reset ? rows : rows.filter(l => l[1] !== ' ')).map(l => `${l.slice(0, 2)} ${l.slice(3)}`)
  const target = reset ? resetTarget(risk.args) : 'HEAD'
  const commits = target === 'HEAD' ? [] : (await git(probe, cwd, ['log', '--oneline', '--no-decorate', `${target}..HEAD`])).stdout.split('\n').filter(Boolean)
  const shortstat = (await git(probe, cwd, ['diff', '--shortstat', reset ? target : '--'])).stdout.trim()
  return { kind: 'discard', ok: true, files, commits, shortstat, error: '' }
}

const PUSH_VALUE = new Set(['-o', '--push-option', '--repo', '--receive-pack', '--exec'])

async function measurePush(risk: GitRisk, cwd: string, probe: Probe): Promise<Facts> {
  const [remote, refspec] = positionals(risk.args, PUSH_VALUE)
  let source = 'HEAD'
  let target = ''
  if (refspec) {
    const ref = refspec.replace(/^\+/, '')
    const [from, to] = ref.includes(':') ? ref.split(':') : [ref, ref]
    source = from || 'HEAD'
    target = `${remote ?? 'origin'}/${(to ?? '').replace(/^refs\/heads\//, '')}`
  } else if (remote === undefined) {
    // No remote and no branch: wherever this branch pushes to.
    const push = await git(probe, cwd, ['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{push}'])
    if (push.exitCode === 0 && push.stdout.trim()) target = push.stdout.trim()
  }
  if (!target || target.endsWith('/') || target.endsWith('/HEAD')) {
    const branch = (await git(probe, cwd, ['rev-parse', '--abbrev-ref', 'HEAD'])).stdout.trim()
    target = `${remote ?? 'origin'}/${branch}`
  }
  if ((await git(probe, cwd, ['rev-parse', '--verify', '--quiet', target])).exitCode !== 0) return { kind: 'push', target, source, known: false, commits: [] }
  const commits = (await git(probe, cwd, ['log', '--oneline', '--no-decorate', `${source}..${target}`])).stdout.split('\n').filter(Boolean)
  return { kind: 'push', target, source, known: true, commits }
}

// ---------------------------------------------------------------------------
// Migrations

const LISTERS: Record<string, { argv: (windows: boolean) => string[]; pending: (l: string) => boolean; clean: (l: string) => string }> = {
  django: { argv: w => [w ? 'python' : 'python3', 'manage.py', 'showmigrations', '--plan'], pending: l => l.startsWith('[ ]'), clean: l => l.slice(4) },
  alembic: { argv: () => ['alembic', 'history', '-r', 'current:head'], pending: l => l.includes('->'), clean: l => l },
  rails: { argv: () => ['bin/rails', 'db:migrate:status'], pending: l => /^\s*down\b/.test(l), clean: l => l.trim() },
  prisma: { argv: w => [w ? 'npx.cmd' : 'npx', '--no-install', 'prisma', 'migrate', 'status'], pending: l => /^\s{2}\S/.test(l), clean: l => l.trim() },
}

async function measureMigration(risk: MigrationRisk, cwd: string, probe: Probe): Promise<Facts> {
  const lister = LISTERS[risk.tool]
  if (lister === undefined) return { kind: 'migrate', argv: null, ok: false, pending: [] }
  const argv = lister.argv(probe.windows)
  const run = await probe.run(argv, { cwd, timeoutMs: 20_000 })
  if (run.exitCode !== 0) return { kind: 'migrate', argv, ok: false, pending: [] }
  return { kind: 'migrate', argv, ok: true, pending: run.stdout.split('\n').filter(lister.pending).map(lister.clean) }
}

// ---------------------------------------------------------------------------
// Installs

/** The global npm packages and their versions, read from disk only (no network); null if unreadable. */
async function globalNpm(probe: Probe): Promise<Record<string, string> | null> {
  const run = await probe.run([probe.windows ? 'npm.cmd' : 'npm', 'ls', '-g', '--depth=0', '--json'], { timeoutMs: 15_000 })
  try {
    const data = JSON.parse(run.stdout) as { dependencies?: Record<string, { version?: unknown }> }
    return Object.fromEntries(Object.entries(data.dependencies ?? {}).map(([name, d]) => [name, typeof d.version === 'string' ? d.version : '?']))
  } catch {
    return null
  }
}

async function measureInstall(risk: InstallRisk, probe: Probe): Promise<Facts> {
  return { kind: 'install', installed: risk.manager === 'npm' && risk.packages.length > 0 ? await globalNpm(probe) : null }
}

/** The installed version of an npm package spec (`typescript@5.7` → `5.6.2`), if any. */
export function installedVersion(installed: Record<string, string> | null, spec: string): string | undefined {
  return installed?.[npmPackageName(spec)]
}
