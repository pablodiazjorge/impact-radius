// Which shell commands are risky and which folder they run in. Returns data, never prose: the
// words live in messages.ts. No `$`: tested directly.
//
// The idea comes from blast-radius, in Anthropic's claude-code-playground; this code is new and
// also understands PowerShell, Claude's usual shell on Windows, and third-party installs.

import { activatesVenv, type InstallRisk, installRisk } from './installs'
import { commandName, isParam, joinDir, segments, type Shell, stripPrefixes } from './shell'

export type GitOp = 'reset-hard' | 'clean' | 'push-force' | 'discard'
export type MigrationTool = 'django' | 'alembic' | 'rails' | 'prisma' | 'other'

/** `command` is a short literal label (`rm -rf`, `git reset --hard`); `dir` is null for the session's folder. */
export type DeleteRisk = { kind: 'delete'; command: string; dir: string | null; targets: string[] }
export type GitRisk = { kind: 'git'; op: GitOp; command: string; dir: string | null; args: string[] }
export type MigrationRisk = { kind: 'migrate'; tool: MigrationTool; command: string; dir: string | null }
export type Risk = DeleteRisk | GitRisk | MigrationRisk | InstallRisk

/** A change of folder (`cd`, `Set-Location`, `pushd`, `popd`): null is the session's, `-` the unknown previous one. */
type DirChange = { cd: string | null }

/** Commands that only read: a stray "migrate" among their words is not a migration. */
const READ_ONLY = new Set([
  'ls', 'cat', 'echo', 'printf', 'grep', 'rg', 'find', 'less', 'head', 'tail', 'cd', 'git',
  'get-content', 'gc', 'type', 'select-string', 'sls', 'get-childitem', 'gci', 'dir', 'write-output', 'write-host',
])
/** Remove-Item and its PowerShell aliases. */
const POWERSHELL_DELETE = new Set(['remove-item', 'ri', 'rm', 'del', 'erase', 'rd', 'rmdir'])
const POWERSHELL_CD = new Set(['cd', 'chdir', 'sl', 'set-location'])
const PUSHD = new Set(['pushd', 'push-location'])
const POPD = new Set(['popd', 'pop-location'])

function powershellDelete(command: string, args: string[], dir: string | null): DeleteRisk | null {
  const targets: string[] = []
  const flags: string[] = []
  let recurse = false
  let force = false
  for (let i = 0; i < args.length; i++) {
    const a = args[i] ?? ''
    if (!a.startsWith('-')) {
      targets.push(...a.split(',').filter(Boolean))
      continue
    }
    const value = a.includes(':') ? a.slice(a.indexOf(':') + 1) : undefined
    if (isParam(a, 'whatif', 1)) return null // only shows what it would do
    if (isParam(a, 'recurse', 1)) {
      recurse = true
      flags.push('-Recurse')
    } else if (isParam(a, 'force', 2)) {
      force = true
      flags.push('-Force')
    } else if (isParam(a, 'path', 1) || isParam(a, 'literalpath', 1) || /^-(lp|pspath)$/i.test(a.split(':')[0] ?? '')) {
      const v = value ?? args[++i]
      if (v) targets.push(...v.split(',').filter(Boolean))
    } else if (['filter', 'include', 'exclude', 'credential', 'stream'].some(n => isParam(a, n, 2)) && value === undefined) {
      i++ // its value is not a path
    }
  }
  if (!recurse && !force) return null
  return { kind: 'delete', command: `${command} ${flags.join(' ')}`.trim(), dir, targets }
}

function bashDelete(args: string[], dir: string | null): DeleteRisk | null {
  const end = args.indexOf('--')
  const options = (end < 0 ? args : args.slice(0, end)).filter(a => a.startsWith('-') && a !== '-')
  const recurse = options.some(f => f === '--recursive' || (/^-[^-]/.test(f) && /[rR]/.test(f)))
  const force = options.some(f => f === '--force' || (/^-[^-]/.test(f) && f.includes('f')))
  if (!recurse && !force) return null
  const targets = end < 0 ? args.filter(a => !a.startsWith('-') || a === '-') : [...args.slice(0, end).filter(a => !a.startsWith('-')), ...args.slice(end + 1)]
  return { kind: 'delete', command: `rm ${options.join(' ')}`.trim(), dir, targets }
}

function gitRisk(args: string[], dir: string | null): GitRisk | null {
  let gitDir = dir
  let i = 0
  while (i < args.length && (args[i] ?? '').startsWith('-')) {
    if (args[i] === '-C' && i + 1 < args.length) {
      gitDir = joinDir(gitDir, args[i + 1])
      i += 2
    } else if (args[i] === '-c' && i + 1 < args.length) i += 2
    else i += 1
  }
  const sub = args[i]
  const rest = args.slice(i + 1)
  if (sub === 'reset' && rest.includes('--hard')) return { kind: 'git', op: 'reset-hard', command: 'git reset --hard', dir: gitDir, args: rest }
  if (sub === 'clean' && !rest.some(a => a === '-n' || a === '--dry-run' || /^-[a-zA-Z]*n/.test(a))) {
    return { kind: 'git', op: 'clean', command: 'git clean', dir: gitDir, args: rest }
  }
  if (sub === 'push' && rest.some(a => a === '--force' || a === '-f' || a.startsWith('--force-with-lease') || /^\+/.test(a))) {
    return { kind: 'git', op: 'push-force', command: 'git push --force', dir: gitDir, args: rest }
  }
  const stagedOnly = sub === 'restore' && rest.includes('--staged') && !rest.includes('--worktree') && !rest.includes('-W')
  if ((sub === 'checkout' || sub === 'restore') && rest.includes('.') && !stagedOnly) {
    return { kind: 'git', op: 'discard', command: `git ${sub} -- .`, dir: gitDir, args: rest }
  }
  return null
}

function migration(name: string, args: string[], dir: string | null): MigrationRisk | null {
  const line = [name, ...args].join(' ')
  if (/\balembic\s+upgrade\b/.test(line)) return { kind: 'migrate', tool: 'alembic', command: 'alembic upgrade', dir }
  if (/\bdb:migrate(?!:status\b)/.test(line)) return { kind: 'migrate', tool: 'rails', command: 'db:migrate', dir }
  if (/\bprisma\s+migrate\s+(dev|deploy|reset)\b/.test(line)) return { kind: 'migrate', tool: 'prisma', command: 'prisma migrate', dir }
  if (/\bmanage\.py\s+migrate\b/.test(line)) return { kind: 'migrate', tool: 'django', command: 'manage.py migrate', dir }
  if (!READ_ONLY.has(name.toLowerCase()) && args.includes('migrate')) return { kind: 'migrate', tool: 'other', command: 'migrate', dir }
  return null
}

/** One segment: a risk, a change of folder or nothing. */
function classifySegment(
  words: string[],
  dir: string | null,
  stack: (string | null)[],
  shell: Shell,
  input: string[] | null,
  inVenv: boolean,
): Risk | DirChange | null {
  const [first, ...args] = stripPrefixes(words, shell)
  if (first === undefined) return null
  const name = commandName(first, shell)
  const target = () => {
    if (shell === 'bash') return args[0]
    for (let i = 0; i < args.length; i++) {
      const a = args[i] ?? ''
      if (!a.startsWith('-')) return a
      if (isParam(a, 'path', 1) || isParam(a, 'literalpath', 1)) return a.includes(':') ? a.slice(a.indexOf(':') + 1) : args[i + 1]
    }
    return undefined
  }
  if (name === 'cd' || (shell === 'powershell' && POWERSHELL_CD.has(name))) {
    const a = target()
    return { cd: a === '-' ? '-' : joinDir(dir, a) }
  }
  if (PUSHD.has(name)) {
    stack.push(dir)
    return { cd: joinDir(dir, target()) }
  }
  if (POPD.has(name)) return { cd: stack.length > 0 ? (stack.pop() ?? null) : '-' }
  if (shell === 'bash' && name === 'rm') {
    const r = bashDelete(args, dir)
    if (r) return r
  }
  if (shell === 'powershell' && POWERSHELL_DELETE.has(name)) {
    const r = powershellDelete(name === 'remove-item' ? 'Remove-Item' : name, args, dir)
    if (r) return r
  }
  if (name === 'git') {
    const r = gitRisk(args, dir)
    if (r) return r
  }
  return installRisk(first, name, args, dir, shell, input, inVenv) ?? migration(name, args, dir)
}

/** Every risky segment of a command line, in order; empty when there is none. */
export function classify(command: string, shell: Shell): Risk[] {
  const risks: Risk[] = []
  let dir: string | null = null
  const subshells: (string | null)[] = []
  const stack: (string | null)[] = []
  let previous: string[] | null = null
  let inVenv = false
  for (const segment of segments(command, shell)) {
    for (let k = 0; k < segment.opens; k++) subshells.push(dir)
    const input = segment.piped ? previous : null
    const r: Risk | DirChange | null = segment.words.length > 0 ? classifySegment(segment.words, dir, stack, shell, input, inVenv) : null
    if (r !== null && 'kind' in r) risks.push(r)
    else if (r !== null) dir = r.cd
    if (segment.words.length > 0) {
      if (activatesVenv(segment.words, shell)) inVenv = true
      previous = stripPrefixes(segment.words, shell)
    }
    for (let k = 0; k < segment.closes && subshells.length > 0; k++) dir = subshells.pop() ?? null
  }
  return risks
}
