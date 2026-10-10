// Splitting a command line into segments and words, and the path and option helpers the rules
// share. No `$`: tested directly.

export type Shell = 'bash' | 'powershell'

/**
 * One command between `&&`, `||`, `;`, `|`, newlines or braces. `opens` and `closes` count the
 * parentheses around it, to know where a `cd` made inside a subshell ends; `piped` means it reads
 * what the previous segment writes.
 */
export type Segment = { words: string[]; opens: number; closes: number; piped: boolean }

// ---------------------------------------------------------------------------
// Segments and words

/** Splits a command line into segments and each segment into words, honouring quotes. */
export function segments(command: string, shell: Shell): Segment[] {
  const escape = shell === 'bash' ? '\\' : '`'
  const out: Segment[] = []
  let words: string[] = []
  let word = ''
  let started = false
  let quote = ''
  let opens = 0
  let closes = 0
  let piped = false
  let nested = 0 // inside $( … ) or @( … ): part of the word
  const endWord = () => {
    if (started) words.push(word)
    word = ''
    started = false
  }
  const endSegment = () => {
    endWord()
    if (words.length > 0 || opens > 0 || closes > 0) out.push({ words, opens, closes, piped })
    words = []
    opens = 0
    closes = 0
    piped = false
  }
  for (let i = 0; i < command.length; i++) {
    const c = command[i] ?? ''
    const next = command[i + 1] ?? ''
    if (quote) {
      if (c === quote) quote = ''
      else if (c === escape && quote === '"' && i + 1 < command.length) word += command[++i]
      else word += c
      continue
    }
    if (nested > 0) {
      word += c
      if (c === '(') nested++
      else if (c === ')') nested--
      continue
    }
    if (c === '"' || c === "'") {
      quote = c
      started = true
    } else if (c === escape && i + 1 < command.length && next !== '\n') {
      word += command[++i]
      started = true
    } else if (c === '(' && (word.endsWith('$') || word.endsWith('@'))) {
      word += c
      nested = 1
    } else if (c === '(' && !started && words.length === 0) {
      opens++
    } else if (c === ')') {
      endWord()
      closes++
    } else if (c === ' ' || c === '\t' || c === '\r') {
      endWord()
    } else if (c === '\n' || c === ';' || c === '{' || c === '}') {
      endSegment()
    } else if ((c === '&' || c === '|') && next === c) {
      i++
      endSegment()
    } else if (c === '|') {
      endSegment()
      piped = true
    } else if (c === '&' && shell === 'bash' && command[i - 1] !== '>' && next !== '>') {
      endSegment() // `&` sends the command to the background; in PowerShell it is the call operator
    } else {
      word += c
      started = true
    }
  }
  endSegment()
  return out
}

const SUDO_OPTIONS = new Set(['-u', '-g', '-C', '-D', '-h', '-p', '-r', '-t', '-T', '-U'])
const PREFIXES = new Set(['command', 'exec', 'env', 'nohup', 'time', 'then', 'do', 'else', 'elif', 'if', 'while', 'until', '!', 'xargs'])

/** A command's name: no path, no `.exe`, and case-insensitive in PowerShell. */
export function commandName(word: string, shell: Shell): string {
  const bare = word.replace(/^\\/, '').split(/[\\/]/).pop() ?? ''
  const name = bare.replace(/\.(exe|cmd|bat)$/i, '')
  return shell === 'powershell' ? name.toLowerCase() : name
}

/** Drops what comes before the real command: variables, `sudo`, `nice`, `&`… */
export function stripPrefixes(words: string[], shell: Shell): string[] {
  const w = [...words]
  const isVariable = (s: string | undefined) => /^[A-Za-z_][A-Za-z0-9_]*=/.test(s ?? '')
  for (;;) {
    const first = w[0]
    if (first === undefined) return w
    if (shell === 'bash' && isVariable(first)) w.shift()
    else if (shell === 'powershell' && (first === '&' || first === '.')) w.shift()
    else if (PREFIXES.has(shell === 'powershell' ? first.toLowerCase() : first)) w.shift()
    else if (first === 'sudo') {
      w.shift()
      while ((w[0] ?? '').startsWith('-')) {
        const option = w.shift() ?? ''
        if (SUDO_OPTIONS.has(option)) w.shift()
      }
    } else if (first === 'nice') {
      w.shift()
      if (w[0] === '-n') w.splice(0, 2)
      else if (/^-\d+$/.test(w[0] ?? '')) w.shift()
    } else return w
  }
}

/** A PowerShell parameter, abbreviated or not: `-Rec` stands for `-Recurse` from `minimum` letters. */
export function isParam(arg: string, name: string, minimum: number): boolean {
  const m = /^-([A-Za-z]+)(:.*)?$/.exec(arg)
  const written = (m?.[1] ?? '').toLowerCase()
  return written.length >= minimum && name.startsWith(written)
}

/** The words that are not options, skipping the value of each option in `withValue`. */
export function positionals(args: string[], withValue: ReadonlySet<string> = new Set()): string[] {
  const out: string[] = []
  for (let i = 0; i < args.length; i++) {
    const a = args[i] ?? ''
    if (a === '--') {
      out.push(...args.slice(i + 1))
      break
    }
    if (a.startsWith('-') && a.length > 1) {
      if (!a.includes('=') && withValue.has(a)) i++
      continue
    }
    out.push(a)
  }
  return out
}

/** An option's value (`--scope user` or `--scope=user`); the last one if repeated. */
export function optionValue(args: string[], ...names: string[]): string | undefined {
  let value: string | undefined
  for (let i = 0; i < args.length; i++) {
    const a = args[i] ?? ''
    if (names.includes(a)) value = args[i + 1]
    const joined = names.find(n => a.startsWith(`${n}=`))
    if (joined) value = a.slice(joined.length + 1)
  }
  return value
}

/** Every value of an option that can repeat. */
export function optionValues(args: string[], ...names: string[]): string[] {
  const out: string[] = []
  for (let i = 0; i < args.length; i++) {
    const a = args[i] ?? ''
    if (names.includes(a) && args[i + 1] !== undefined) out.push(args[++i] ?? '')
    const joined = names.find(n => a.startsWith(`${n}=`))
    if (joined) out.push(a.slice(joined.length + 1))
  }
  return out
}

// ---------------------------------------------------------------------------
// Paths

/** Joins a folder and what `cd` got: an absolute path wins, a relative one is appended. */
export function joinDir(dir: string | null, arg: string | undefined): string {
  if (arg === undefined || arg === '' || arg === '~') return '~'
  if (isAbsolute(arg)) return arg
  return dir ? `${dir.replace(/[\\/]+$/, '')}/${arg}` : arg
}

export function isAbsolute(path: string): boolean {
  return /^([\\/]|~[\\/]|~$|[A-Za-z]:[\\/]|[A-Za-z]:$)/.test(path)
}

/**
 * `path` seen from `base`, absolute and with forward slashes. Understands `~`, Windows drive
 * letters and Git Bash paths (`/c/Users/…`) when the base is a Windows one.
 */
export function resolvePath(base: string, path: string, home = ''): string {
  let p = path.replace(/\\/g, '/')
  const b = base.replace(/\\/g, '/').replace(/\/+$/, '')
  if (home && (p === '~' || p.startsWith('~/'))) p = home.replace(/\\/g, '/').replace(/\/+$/, '') + p.slice(1)
  if (/^[A-Za-z]:/.test(b)) p = p.replace(/^\/([A-Za-z])(?=\/|$)/, (_, letter: string) => `${letter.toUpperCase()}:`)
  let root = ''
  let rest = p
  if (/^[A-Za-z]:/.test(p)) {
    root = p.slice(0, 2).toUpperCase()
    rest = p.slice(2)
  } else if (!p.startsWith('/')) {
    const drive = /^[A-Za-z]:/.test(b) ? b.slice(0, 2).toUpperCase() : ''
    root = drive
    rest = `${b.slice(drive.length)}/${p}`
  }
  const parts: string[] = []
  for (const part of rest.split('/')) {
    if (part === '' || part === '.') continue
    if (part === '..') parts.pop()
    else parts.push(part)
  }
  return `${root}/${parts.join('/')}`
}

export function dirOf(path: string): string {
  const i = path.lastIndexOf('/')
  if (i < 0) return '.'
  if (i === 0) return '/'
  const parent = path.slice(0, i)
  return /^[A-Za-z]:$/.test(parent) ? `${parent}/` : parent
}

export function baseName(path: string): string {
  return path.slice(path.lastIndexOf('/') + 1)
}

/** `path` relative to `base` when it is inside it; otherwise whole. */
export function relativeTo(base: string, path: string): string {
  const b = base.replace(/\/+$/, '')
  return path.toLowerCase().startsWith(`${b.toLowerCase()}/`) ? path.slice(b.length + 1) : path
}

export function hasWildcards(text: string): boolean {
  return /[*?[]/.test(text)
}

/** A shell wildcard (`*.log`, `build?`, `[ab]*`) as a case-insensitive regular expression. */
export function wildcardToRegex(pattern: string): RegExp {
  let re = ''
  for (let i = 0; i < pattern.length; i++) {
    const c = pattern[i] ?? ''
    if (c === '*') re += '.*'
    else if (c === '?') re += '.'
    else if (c === '[') {
      const end = pattern.indexOf(']', i + 1)
      if (end < 0) re += '\\['
      else {
        re += `[${pattern.slice(i + 1, end).replace(/^!/, '^').replace(/\\/g, '\\\\')}]`
        i = end
      }
    } else re += c.replace(/[.+^${}()|\\]/g, m => `\\${m}`)
  }
  return new RegExp(`^${re}$`, 'i')
}
