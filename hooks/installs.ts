// Third-party software installed for the whole user or system, outside the project: a global
// package, a language tool, a module, an editor extension, a Claude Code plugin or an installer
// piped from the internet. No `$`: tested directly.

import { commandName, isParam, optionValue, optionValues, positionals, type Shell, stripPrefixes } from './shell'

/** Where an install lands, phrased by `messages.ts`. */
export type Scope =
  | 'js-global'
  | 'python-tool'
  | 'python-system'
  | 'python-user'
  | 'python-outside-venv'
  | 'machine'
  | 'system'
  | 'user-manager'
  | 'ruby-gems'
  | 'cargo-bin'
  | 'go-bin'
  | 'volta'
  | 'nvm'
  | 'powershell-user'
  | 'powershell-all-users'
  | 'editor'
  | 'claude-plugin'
  | 'claude-mcp-user'
  | 'deno-global'
  | 'dotnet-global'
  | 'remote'

/** What gets installed, as the command names it; `from` says it is not a package name. */
export type Package = { name: string; from?: 'requirements' | 'editable' | 'path' }

export type InstallRisk = {
  kind: 'install'
  /** The command as a short literal label: `npm install -g`, `winget install`… */
  command: string
  dir: string | null
  /** `npm`, `pip`, `winget`… or `remote` for an installer piped from the internet. */
  manager: string
  action: 'install' | 'update'
  /** Empty when the command doesn't say. */
  packages: Package[]
  scope: Scope
  /** The tool's display name for the scopes that mention it: `Homebrew`, `apt`, `Cursor`… */
  via?: string
  /** Where a remote installer is downloaded from. */
  source?: string
  /** pip without `--user`: only for the whole user when no virtual environment is active. */
  venvDependent?: true
}

const UPDATE = /\b(upgrade|update|up|refresh|full-upgrade|dist-upgrade)\b/i

const install = (manager: string, command: string, packages: Package[], scope: Scope, dir: string | null, via?: string): InstallRisk => ({
  kind: 'install',
  command,
  dir,
  manager,
  action: UPDATE.test(command) ? 'update' : 'install',
  packages,
  scope,
  ...(via ? { via } : {}),
})

const named = (names: string[]): Package[] => names.map(name => ({ name }))

// ---------------------------------------------------------------------------
// JavaScript

const NPM_VALUE = new Set(['--registry', '--prefix', '--tag', '--location', '-w', '--workspace', '--omit', '--include', '--save-prefix', '--cache', '--userconfig', '--filter', '-C', '--dir'])
const NPM_SUBCOMMANDS = new Set(['install', 'i', 'in', 'add', 'isntall', 'update', 'up', 'upgrade'])
const PNPM_BUN_SUBCOMMANDS = new Set(['add', 'install', 'i', 'a', 'update', 'up', 'upgrade'])

/** npm, pnpm and bun with `-g`, and `yarn global add`. */
function javascript(name: string, args: string[], dir: string | null): InstallRisk | null {
  if (name === 'yarn') {
    const [global, sub, ...packages] = positionals(args, NPM_VALUE)
    if (global !== 'global' || (sub !== 'add' && sub !== 'upgrade')) return null
    return install('yarn', `yarn global ${sub}`, named(packages), 'js-global', dir)
  }
  const global =
    args.some(a => a === '-g' || a === '--global' || a === '--global=true' || a === '--location=global') ||
    optionValue(args, '--location') === 'global'
  if (!global) return null
  const [sub, ...packages] = positionals(args, NPM_VALUE)
  if (!(name === 'npm' ? NPM_SUBCOMMANDS : PNPM_BUN_SUBCOMMANDS).has(sub ?? '')) return null
  return install(name, `${name} ${sub} -g`, named(packages), 'js-global', dir)
}

/** A package name without its version (`@scope/x@1.2` → `@scope/x`). */
export function npmPackageName(spec: string): string {
  if (spec.startsWith('@')) {
    const i = spec.indexOf('@', 1)
    return i < 0 ? spec : spec.slice(0, i)
  }
  const i = spec.indexOf('@')
  return i <= 0 ? spec : spec.slice(0, i)
}

// ---------------------------------------------------------------------------
// Python

const IS_PIP = /^pip(\d+(\.\d+)*)?$/i
const IS_PYTHON = /^(python(\d+(\.\d+)*)?|py)$/i
const PIP_VALUE = new Set([
  '-r', '--requirement', '-c', '--constraint', '-e', '--editable', '-i', '--index-url', '--extra-index-url', '-f',
  '--find-links', '--proxy', '--log', '--timeout', '--retries', '--platform', '--python-version', '--implementation',
  '--abi', '--src', '--upgrade-strategy', '--progress-bar', '--trusted-host', '--cert', '--client-cert', '--cache-dir',
  '--exists-action', '--global-option', '--config-settings', '-C', '--only-binary', '--no-binary',
])

/** A pip or python from a virtual environment, by its path (`.venv/bin/pip`, `venv\Scripts\python`). */
export function isVenvCommand(command: string): boolean {
  return /(^|[\\/])\.?(venv|env|virtualenv)[^\\/]*[\\/]/i.test(command)
}

/** Whether a segment activates a Python virtual environment for what follows. */
export function activatesVenv(words: string[], shell: Shell): boolean {
  const [first, ...args] = stripPrefixes(words, shell)
  if (first === undefined) return false
  const name = commandName(first, shell).toLowerCase()
  const isActivate = (path: string | undefined) => /(^|[\\/])activate(\.(ps1|bat|fish|csh))?$/i.test(path ?? '')
  if ((name === 'source' || name === '.') && isActivate(args[0])) return true
  if (isActivate(first)) return true
  if (name === 'conda' && args[0] === 'activate') return (args[1] ?? 'base') !== 'base'
  return name === 'workon' || (name === 'poetry' && args[0] === 'shell') || (name === 'pyenv' && args[0] === 'activate')
}

/** pip, `python -m pip`, `uv pip --system`, `uv tool` and pipx. */
function python(first: string, name: string, args: string[], dir: string | null, inVenv: boolean): InstallRisk | null {
  const n = name.toLowerCase()
  if (n === 'pipx' && args[0] === 'install') return install('pipx', 'pipx install', named(positionals(args.slice(1), PIP_VALUE)), 'python-tool', dir)
  if (n === 'uv' && args[0] === 'tool' && args[1] === 'install') {
    return install('uv', 'uv tool install', named(positionals(args.slice(2), PIP_VALUE)), 'python-tool', dir)
  }
  let rest: string[] | null = null
  if (IS_PIP.test(n)) rest = args
  else if (n === 'uv' && args[0] === 'pip') rest = args.includes('--system') ? args.slice(1) : null
  else if (IS_PYTHON.test(n)) {
    const m = args.indexOf('-m')
    if (m >= 0 && /^pip\d*$/i.test(args[m + 1] ?? '')) rest = args.slice(m + 2)
  }
  if (rest === null) return null
  const [sub, ...packages] = positionals(rest, PIP_VALUE)
  if (sub !== 'install') return null
  if (rest.some(a => ['--dry-run', '-h', '--help'].includes(a) || /^(--target|--prefix|--root|-t)(=|$)/.test(a))) return null
  if (n !== 'uv' && (inVenv || isVenvCommand(first))) return null
  const all: Package[] = [
    ...named(packages),
    ...optionValues(rest, '-r', '--requirement').map(name => ({ name, from: 'requirements' as const })),
    ...optionValues(rest, '-e', '--editable').map(name => ({ name, from: 'editable' as const })),
  ]
  if (n === 'uv') return install('uv', 'uv pip install --system', all, 'python-system', dir)
  if (rest.includes('--user')) return install('pip', 'pip install --user', all, 'python-user', dir)
  return {
    ...install('pip', 'pip install', all, 'python-outside-venv', dir),
    ...(rest.includes('--break-system-packages') ? {} : { venvDependent: true as const }),
  }
}

// ---------------------------------------------------------------------------
// System package managers and language tools

/** The subcommands that install or update, where it lands and the options that take a value. */
const SYSTEM: Record<string, { subs: string[]; scope: Scope; via?: string; value?: string[]; names?: string[] }> = {
  winget: {
    subs: ['install', 'add', 'upgrade', 'update'],
    scope: 'machine',
    via: 'winget',
    value: ['--source', '-s', '--version', '-v', '--scope', '--location', '-l', '--override', '--log', '-o', '--custom', '--architecture', '-a', '--locale', '--header', '--id', '--name', '--query', '-q', '--moniker', '-m'],
    names: ['--id', '--name', '--query', '-q', '--moniker', '-m'],
  },
  choco: { subs: ['install', 'upgrade'], scope: 'machine', via: 'Chocolatey', value: ['--version', '--source', '-s', '--params', '--package-parameters'] },
  scoop: { subs: ['install', 'update'], scope: 'user-manager', via: 'Scoop' },
  brew: { subs: ['install', 'reinstall', 'upgrade'], scope: 'machine', via: 'Homebrew' },
  apt: { subs: ['install', 'reinstall', 'upgrade', 'full-upgrade', 'dist-upgrade'], scope: 'system', via: 'apt' },
  'apt-get': { subs: ['install', 'reinstall', 'upgrade', 'dist-upgrade'], scope: 'system', via: 'apt' },
  dnf: { subs: ['install', 'reinstall', 'upgrade', 'update'], scope: 'system', via: 'dnf' },
  yum: { subs: ['install', 'reinstall', 'upgrade', 'update'], scope: 'system', via: 'yum' },
  zypper: { subs: ['install', 'in', 'update', 'up'], scope: 'system', via: 'zypper' },
  apk: { subs: ['add', 'upgrade'], scope: 'system', via: 'apk' },
  snap: { subs: ['install', 'refresh'], scope: 'system', via: 'snap' },
  flatpak: { subs: ['install', 'update'], scope: 'system', via: 'Flatpak' },
  port: { subs: ['install', 'upgrade'], scope: 'machine', via: 'MacPorts' },
  gem: { subs: ['install', 'update'], scope: 'ruby-gems', value: ['-v', '--version', '-i', '--install-dir', '-n', '--bindir', '--source', '-s', '-P', '--trust-policy', '--platform'] },
  cargo: {
    subs: ['install', 'binstall'],
    scope: 'cargo-bin',
    value: ['--version', '--git', '--branch', '--tag', '--rev', '--path', '--root', '--index', '--registry', '--target', '--features', '-F', '-j', '--jobs', '--profile', '--bin', '--example', '--target-dir', '--config'],
  },
  go: { subs: ['install'], scope: 'go-bin', value: ['-tags', '-ldflags', '-gcflags', '-mod', '-modfile', '-p', '-pkgdir', '-toolexec', '-overlay'] },
  volta: { subs: ['install'], scope: 'volta' },
  nvm: { subs: ['install'], scope: 'nvm' },
}

function system(name: string, args: string[], dir: string | null): InstallRisk | null {
  const n = name.toLowerCase()
  if (n === 'cinst') return install('choco', 'cinst', named(positionals(args)), 'machine', dir, 'Chocolatey')
  if (n === 'pacman') {
    if (!args.some(a => /^-S[yu]*$/.test(a) || a === '--sync')) return null
    return install('pacman', 'pacman -S', named(positionals(args)), 'system', dir, 'pacman')
  }
  const rule = SYSTEM[n]
  if (rule === undefined) return null
  const [sub, ...rest] = positionals(args, new Set(rule.value ?? []))
  if (!rule.subs.includes(sub ?? '')) return null
  const packages = named([...rest, ...(rule.names ? optionValues(args, ...rule.names) : [])])
  if (n === 'cargo' && args.includes('--path')) packages.push({ name: optionValue(args, '--path') ?? '.', from: 'path' })
  return install(n, `${n} ${sub}`, packages, rule.scope, dir, rule.via)
}

// ---------------------------------------------------------------------------
// PowerShell modules, editors, Claude Code, Deno and .NET

const POWERSHELL_MODULES = new Set(['install-module', 'install-package', 'install-script', 'install-psresource', 'update-module', 'update-psresource'])
const EDITORS: Record<string, string> = { code: 'VS Code', 'code-insiders': 'VS Code Insiders', codium: 'VSCodium', cursor: 'Cursor' }

function powershellModule(name: string, args: string[], dir: string | null): InstallRisk | null {
  if (!POWERSHELL_MODULES.has(name)) return null
  const packages: string[] = []
  let scope = ''
  for (let i = 0; i < args.length; i++) {
    const a = args[i] ?? ''
    const value = a.includes(':') ? a.slice(a.indexOf(':') + 1) : undefined
    if (!a.startsWith('-')) packages.push(...a.split(',').filter(Boolean))
    else if (isParam(a, 'name', 1)) packages.push(...(value ?? args[++i] ?? '').split(',').filter(Boolean))
    else if (isParam(a, 'scope', 2)) scope = (value ?? args[++i] ?? '').toLowerCase()
    else if (['repository', 'requiredversion', 'minimumversion', 'maximumversion', 'version', 'source', 'providername', 'credential', 'proxy'].some(p => isParam(a, p, 3)) && value === undefined) i++
  }
  const label = name.replace(/(^|-)([a-z])/g, (_, dash: string, letter: string) => `${dash}${letter.toUpperCase()}`).replace('Psresource', 'PSResource')
  return install('powershell', label, named(packages), scope === 'allusers' ? 'powershell-all-users' : 'powershell-user', dir)
}

/** VS Code extensions (and its forks), Claude Code plugins and user MCP servers, Deno and .NET tools. */
function application(name: string, args: string[], dir: string | null): InstallRisk | null {
  const n = name.toLowerCase()
  const editor = EDITORS[n]
  if (editor !== undefined) {
    const extensions = optionValues(args, '--install-extension')
    return extensions.length > 0 ? install(n, `${n} --install-extension`, named(extensions), 'editor', dir, editor) : null
  }
  if (n === 'claude') {
    const [group, sub, ...rest] = positionals(args, new Set(['--scope', '-s', '-e', '--env', '-H', '--header', '-t', '--transport']))
    const scope = optionValue(args, '--scope', '-s')
    if ((group === 'plugin' || group === 'plugins') && (sub === 'install' || sub === 'i')) {
      return (scope ?? 'user') === 'user' ? install('claude', 'claude plugin install', named(rest), 'claude-plugin', dir) : null
    }
    if (group === 'mcp' && (sub === 'add' || sub === 'add-json') && scope === 'user') {
      return install('claude', `claude mcp ${sub} --scope user`, named(rest.slice(0, 1)), 'claude-mcp-user', dir)
    }
    return null
  }
  if (n === 'deno' && args[0] === 'install' && args.some(a => a === '-g' || a === '--global')) {
    const packages = positionals(args.slice(1), new Set(['-n', '--name', '--root', '-c', '--config', '--import-map', '--lock', '--cert', '--location']))
    return install('deno', 'deno install -g', named(packages), 'deno-global', dir)
  }
  if (n === 'dotnet' && args[0] === 'tool' && (args[1] === 'install' || args[1] === 'update') && args.some(a => a === '-g' || a === '--global')) {
    const packages = positionals(args.slice(2), new Set(['--version', '--add-source', '--configfile', '--framework', '-f', '--tool-path', '--tool-manifest', '-a', '--arch', '-v', '--verbosity']))
    return install('dotnet', `dotnet tool ${args[1]} -g`, named(packages), 'dotnet-global', dir)
  }
  return null
}

// ---------------------------------------------------------------------------
// Installers piped from the internet

const DOWNLOADERS = new Set(['curl', 'wget', 'iwr', 'irm', 'invoke-webrequest', 'invoke-restmethod'])
const INTERPRETERS = new Set(['sh', 'bash', 'zsh', 'dash', 'ksh', 'fish', 'python', 'python3', 'py', 'node', 'perl', 'ruby', 'iex', 'invoke-expression', 'pwsh', 'powershell'])
const DOWNLOAD_INSIDE = /(\$\(|<\(|\(|^)\s*(curl|wget|iwr|irm|invoke-webrequest|invoke-restmethod)(\.exe)?\b|downloadstring\(/i

/**
 * Whether the interpreter runs what reaches it through the pipe as a script: `sh`, `bash -s`,
 * `python3 -` or `iex` do; `python3 -m json.tool` or `node -e …` don't, they only read data.
 */
function runsInputAsScript(interpreter: string, args: string[]): boolean {
  if (interpreter === 'iex' || interpreter === 'invoke-expression') return true
  if (interpreter === 'pwsh' || interpreter === 'powershell') {
    return args.length === 0 || args.includes('-') || args.some((a, i) => /^-c(ommand)?$/i.test(a) && args[i + 1] === '-')
  }
  for (const a of args) {
    if (['-c', '-m', '-e', '--eval', '-p', '--print', '-r'].includes(a)) return false
    if (a === '-') return true
    if (!a.startsWith('-')) return false // a script file: what comes through the pipe is data
  }
  return true
}

const urlIn = (words: string[]): string | undefined => {
  for (const w of words) {
    const url = /https?:\/\/[^\s'"()]+/i.exec(w)?.[0]
    if (url) return url
  }
  return undefined
}

/**
 * An installer from the internet that runs without being saved: `curl … | sh`, `irm … | iex`,
 * `bash -c "$(curl …)"`, `iex (irm …)` or `iex ((New-Object Net.WebClient).DownloadString(…))`.
 */
function remoteInstaller(name: string, args: string[], input: string[] | null, shell: Shell, dir: string | null): InstallRisk | null {
  const interpreter = name.toLowerCase()
  if (!INTERPRETERS.has(interpreter)) return null
  let downloader: string | undefined
  let words: string[] = []
  const [piped, ...pipedArgs] = input ?? []
  if (piped !== undefined && DOWNLOADERS.has(commandName(piped, shell).toLowerCase()) && runsInputAsScript(interpreter, args)) {
    downloader = commandName(piped, shell).toLowerCase()
    words = pipedArgs
  } else if (args.some(a => DOWNLOAD_INSIDE.test(a))) {
    downloader = /(curl|wget|iwr|irm|invoke-webrequest|invoke-restmethod|downloadstring)/i.exec(args.join(' '))?.[1]?.toLowerCase()
    words = args
  }
  if (downloader === undefined) return null
  const source = urlIn(words)
  return {
    ...install('remote', `${downloader === 'downloadstring' ? 'DownloadString' : downloader} … | ${interpreter}`, [], 'remote', dir),
    ...(source ? { source } : {}),
  }
}

/** A third-party install for the whole user or system, or null. */
export function installRisk(
  first: string,
  name: string,
  args: string[],
  dir: string | null,
  shell: Shell,
  input: string[] | null,
  inVenv: boolean,
): InstallRisk | null {
  const n = name.toLowerCase()
  if (n === 'npm' || n === 'pnpm' || n === 'bun' || n === 'yarn') return javascript(n, args, dir)
  return (
    python(first, name, args, dir, inVenv) ??
    system(name, args, dir) ??
    (shell === 'powershell' ? powershellModule(n, args, dir) : null) ??
    application(name, args, dir) ??
    remoteInstaller(name, args, input, shell, dir)
  )
}
