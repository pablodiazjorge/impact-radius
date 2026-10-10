// Every word the person and Claude read, in English and Spanish. Built from the data classify.ts
// and measure.ts return. No `$`: tested directly.

import type { Risk } from './classify'
import type { InstallRisk, Package } from './installs'
import { type Facts, installedVersion, LIST_MAX } from './measure'

export type Lang = 'en' | 'es'

/** The `language` setting: `Español` (or `es`, `Spanish`) is Spanish, anything else English. */
export function langOf(option: unknown): Lang {
  return typeof option === 'string' && /^(es|español|espanol|spanish)\b/i.test(option.trim()) ? 'es' : 'en'
}

/** Why a held command did not run. */
export type Reason = 'cancel' | 'timeout' | 'interrupted' | 'error' | 'nobody' | 'busy'

/** What the panel shows: one line of effect, up to LIST_MAX lines, how many more, and a note. */
export type Report = { summary: string; lines: string[]; more: number; note: string }

// ---------------------------------------------------------------------------
// Numbers

const NBSP = '\u00a0'

/** `1,234` in English; in Spanish no separator up to four digits and a non-breaking space after (`20 000`). */
export function formatNumber(n: number, lang: Lang): string {
  const digits = String(Math.round(Math.abs(n)))
  const sign = n < 0 ? '-' : ''
  if (lang === 'es' && digits.length <= 4) return sign + digits
  return sign + digits.replace(/\B(?=(\d{3})+(?!\d))/g, lang === 'es' ? NBSP : ',')
}

/** `3.0 KB` in English, `3,0 KB` in Spanish, with a non-breaking space before the unit. */
export function formatSize(bytes: number, lang: Lang): string {
  if (!Number.isFinite(bytes) || bytes < 1024) return `${Math.max(0, Math.round(bytes || 0))}${NBSP}B`
  const units = ['KB', 'MB', 'GB', 'TB']
  let n = bytes
  let i = -1
  while (n >= 1024 && i < units.length - 1) {
    n /= 1024
    i++
  }
  const fixed = n.toFixed(n < 10 ? 1 : 0)
  return `${lang === 'es' ? fixed.replace('.', ',') : fixed}${NBSP}${units[i]}`
}

export function plural(n: number, one: string, many: string, lang: Lang): string {
  return `${formatNumber(n, lang)} ${n === 1 ? one : many}`
}

// ---------------------------------------------------------------------------
// The words

type Words = {
  name: string
  command: string
  effect: string
  cancel: string
  run: string
  cancelKey: string
  runKey: string
  waiting: string
  more: (n: number) => string
  also: (commands: string) => string
  ran: string
  allowed: string
  reasons: Record<Reason, string>
  deny: (reason: string, effect: string) => string
  notMeasured: string
  unmeasured: (command: string) => string
  unmeasuredNote: (detail: string) => string
  inDir: (command: string, dir: string) => string
  missingDir: (dir: string) => string
  deleteNoTargets: (command: string) => string
  deleteNoTargetsNote: string
  deleteMissing: (targets: string) => string
  deleteMissingNote: string
  deleteEmptyDirs: (n: number) => string
  deleteFiles: (n: number, size: string, atLeast: boolean) => string
  paths: (targets: string) => string
  stoppedCounting: (paths: string) => string
  cleanFailed: string
  cleanNothing: string
  cleanPaths: (n: number) => string
  cleanNote: string
  notARepo: (command: string) => string
  discardNothing: string
  discardFiles: (n: number) => string
  dropCommits: (n: number) => string
  discardFilesAndCommits: (files: number, commits: number) => string
  discardNote: (shortstat: string) => string
  statusNote: string
  reflogNote: string
  pushTo: (target: string) => string
  pushUnknown: (target: string) => string
  pushNoLoss: (target: string) => string
  pushDrops: (target: string, n: number) => string
  pushNote: (target: string, source: string) => string
  migrateUnknownTool: string
  migrateUnknownToolNote: string
  migrateFailed: (command: string) => string
  migrateFailedNote: (argv: string) => string
  migrateNothing: (command: string) => string
  migratePending: (n: number) => string
  accordingTo: (argv: string) => string
  remote: (source: string | undefined) => string
  remoteNote: string
  installs: (action: 'install' | 'update', what: string, scope: string) => string
  thirdParty: string
  packages: (n: number) => string
  pkg: (p: Package) => string
  alreadyInstalled: (pkg: string, version: string) => string
  newPackage: (pkg: string) => string
  noVenv: string
  installNote: string
  scope: (risk: InstallRisk) => string
}

const en = (n: number, one: string, many: string) => plural(n, one, many, 'en')
const es = (n: number, one: string, many: string) => plural(n, one, many, 'es')

const EN = {
  name: 'Impact radius',
  command: 'Command',
  effect: 'Effect',
  cancel: 'Cancel',
  run: 'Run',
  cancelKey: 'c',
  runKey: 'r',
  waiting: 'Claude is waiting for your answer',
  more: n => `and ${formatNumber(n, 'en')} more`,
  also: commands => `Also in this command: ${commands}`,
  ran: 'running it',
  allowed: 'the user pressed Run',
  reasons: {
    cancel: 'the user pressed Cancel',
    timeout: 'nobody answered within 10 minutes',
    interrupted: 'the turn was interrupted',
    error: 'the mod hit an error while holding it',
    nobody: 'nobody can answer in this session',
    busy: 'another command was already waiting for an answer',
  },
  deny: (reason, effect) => `Impact radius held this command and did not run it: ${reason}. Expected effect: ${effect}. Do not run it again unless the user asks you to.`,
  notMeasured: 'could not be measured',
  unmeasured: command => `${command} (could not measure it)`,
  unmeasuredNote: detail => `Could not measure it: ${detail}`,
  inDir: (command, dir) => `${command} in ${dir}`,
  missingDir: dir => `Can't find the folder ${dir}, so I couldn't measure what it would change.`,
  deleteNoTargets: command => `${command} with no known paths`,
  deleteNoTargetsNote: "The command doesn't say what it deletes (it may come through a pipe), so I can't measure it.",
  deleteMissing: targets => `deletes nothing: ${targets} doesn't exist`,
  deleteMissingNote: "The paths don't exist, so there is nothing to delete.",
  deleteEmptyDirs: n => `deletes ${en(n, 'empty folder', 'empty folders')}`,
  deleteFiles: (n, size, atLeast) => `deletes ${atLeast ? 'at least ' : ''}${en(n, 'file', 'files')} (${size})`,
  paths: targets => `Paths: ${targets}`,
  stoppedCounting: paths => `${paths}. There are so many that I stopped counting.`,
  cleanFailed: "git clean (couldn't simulate it)",
  cleanNothing: 'removes nothing: no untracked file matches',
  cleanPaths: n => `removes ${en(n, 'untracked path', 'untracked paths')}`,
  cleanNote: "According to git clean -n. What isn't in git can't be recovered.",
  notARepo: command => `${command} (not a repository?)`,
  discardNothing: 'discards nothing: there are no uncommitted changes',
  discardFiles: n => `discards uncommitted changes in ${en(n, 'file', 'files')}`,
  dropCommits: n => `drops ${en(n, 'commit', 'commits')} from the branch`,
  discardFilesAndCommits: (files, commits) => `discards uncommitted changes in ${en(files, 'file', 'files')} and drops ${en(commits, 'commit', 'commits')} from the branch`,
  discardNote: shortstat => `${shortstat}. Uncommitted changes can't be recovered.`,
  statusNote: 'According to git status --porcelain.',
  reflogNote: 'Dropped commits can be recovered with git reflog.',
  pushTo: target => `force-pushes to ${target}`,
  pushUnknown: target => `There's no local copy of ${target}, so I don't know which commits it would drop. Run git fetch first.`,
  pushNoLoss: target => `force-pushes to ${target}: drops no commits`,
  pushDrops: (target, n) => `force-pushes to ${target} and drops ${en(n, 'commit', 'commits')}`,
  pushNote: (target, source) => `Commits on ${target} that ${source} doesn't have, as of the last fetch.`,
  migrateUnknownTool: 'runs migrations',
  migrateUnknownToolNote: "I don't know how to list this tool's pending migrations.",
  migrateFailed: command => `runs ${command}`,
  migrateFailedNote: argv => `I couldn't list the pending migrations (${argv} failed).`,
  migrateNothing: command => `runs ${command}: nothing pending`,
  migratePending: n => `applies ${en(n, 'pending migration', 'pending migrations')}`,
  accordingTo: argv => `According to ${argv}.`,
  remote: source => `runs an installer downloaded from ${source ?? 'the internet'}`,
  remoteNote: "It's a script from the internet that runs with your permissions without being saved first, so what it will do can't be reviewed. If in doubt, open it in a browser first.",
  installs: (action, what, scope) => `${action === 'update' ? 'updates' : 'installs'} ${what} ${scope}`,
  thirdParty: 'third-party software',
  packages: n => en(n, 'package', 'packages'),
  pkg: p => (p.from === 'requirements' ? `the requirements in ${p.name}` : p.from === 'editable' ? `${p.name} (editable)` : p.from === 'path' ? `the folder ${p.name}` : p.name),
  alreadyInstalled: (pkg, version) => `${pkg} (already installed: ${version})`,
  newPackage: pkg => `${pkg} (new)`,
  noVenv: "I don't see an active virtual environment.",
  installNote: "It lands outside the project, for all your sessions, and it's third-party code that runs with your permissions (also while it installs). Check the exact name and where it comes from.",
  scope: risk => {
    switch (risk.scope) {
      case 'js-global': return `in your user's global ${risk.manager}`
      case 'python-tool': return 'as a Python tool for your user'
      case 'python-system': return "in the system's Python"
      case 'python-user': return "in your user's Python"
      case 'python-outside-venv': return "in the system's or your user's Python, outside a virtual environment"
      case 'machine': return `on this machine (${risk.via})`
      case 'system': return `in the system (${risk.via})`
      case 'user-manager': return `for your user (${risk.via})`
      case 'ruby-gems': return "in your user's or the system's Ruby gems"
      case 'cargo-bin': return 'in ~/.cargo/bin, for your user'
      case 'go-bin': return "in Go's bin folder, for your user"
      case 'volta': return 'as a Volta tool for your user'
      case 'nvm': return 'as a Node version for your user'
      case 'powershell-user': return "in your user's PowerShell modules"
      case 'powershell-all-users': return 'for every user on this machine'
      case 'editor': return `in ${risk.via}, for your user`
      case 'claude-plugin': return 'in Claude Code, for your user'
      case 'claude-mcp-user': return 'as a Claude Code MCP server for your user'
      case 'deno-global': return 'as a global Deno tool'
      case 'dotnet-global': return 'as a global .NET tool'
      case 'remote': return 'with whatever the installer decides'
    }
  },
} satisfies Words

const ES = {
  name: 'Radio de impacto',
  command: 'Orden',
  effect: 'Efecto',
  cancel: 'Cancelar',
  run: 'Ejecutar',
  cancelKey: 'c',
  runKey: 'e',
  waiting: 'Claude espera tu respuesta',
  more: n => `y ${formatNumber(n, 'es')} más`,
  also: commands => `También en esta orden: ${commands}`,
  ran: 'la ejecuto',
  allowed: 'la persona pulsó Ejecutar',
  reasons: {
    cancel: 'la persona pulsó Cancelar',
    timeout: 'nadie respondió en 10 minutos',
    interrupted: 'el turno se interrumpió',
    error: 'el mod tuvo un error mientras la retenía',
    nobody: 'en esta sesión no hay nadie que pueda responder',
    busy: 'ya había otra orden esperando respuesta',
  },
  deny: (reason, effect) => `Radio de impacto retuvo esta orden y no la ejecutó: ${reason}. Efecto previsto: ${effect}. No la repitas salvo que la persona te lo pida.`,
  notMeasured: 'no se pudo medir',
  unmeasured: command => `${command} (no he podido medirlo)`,
  unmeasuredNote: detail => `No he podido medirlo: ${detail}`,
  inDir: (command, dir) => `${command} en ${dir}`,
  missingDir: dir => `No encuentro la carpeta ${dir}, así que no he podido medir qué cambiaría.`,
  deleteNoTargets: command => `${command} sin rutas conocidas`,
  deleteNoTargetsNote: 'La orden no dice qué borra (por ejemplo, lo recibe por una tubería), así que no puedo medirlo.',
  deleteMissing: targets => `no borraría nada: no existe ${targets}`,
  deleteMissingNote: 'Las rutas no existen, así que no hay nada que borrar.',
  deleteEmptyDirs: n => `borraría ${es(n, 'carpeta vacía', 'carpetas vacías')}`,
  deleteFiles: (n, size, atLeast) => `borraría ${atLeast ? 'al menos ' : ''}${es(n, 'archivo', 'archivos')} (${size})`,
  paths: targets => `Rutas: ${targets}`,
  stoppedCounting: paths => `${paths}. Hay tantos que he dejado de contar.`,
  cleanFailed: 'git clean (no he podido simularlo)',
  cleanNothing: 'no quitaría nada: ningún archivo sin seguimiento coincide',
  cleanPaths: n => `quitaría ${es(n, 'ruta sin seguimiento', 'rutas sin seguimiento')}`,
  cleanNote: 'Según git clean -n. Lo que no está en git no se puede recuperar.',
  notARepo: command => `${command} (¿no es un repositorio?)`,
  discardNothing: 'no descartaría nada: no hay cambios sin confirmar',
  discardFiles: n => `descartaría los cambios sin confirmar de ${es(n, 'archivo', 'archivos')}`,
  dropCommits: n => `sacaría ${es(n, 'commit', 'commits')} de la rama`,
  discardFilesAndCommits: (files, commits) => `descartaría los cambios sin confirmar de ${es(files, 'archivo', 'archivos')} y sacaría ${es(commits, 'commit', 'commits')} de la rama`,
  discardNote: shortstat => `${shortstat}. Los cambios sin confirmar no se pueden recuperar.`,
  statusNote: 'Según git status --porcelain.',
  reflogNote: 'Los commits que salen de la rama se pueden recuperar con git reflog.',
  pushTo: target => `forzaría la subida a ${target}`,
  pushUnknown: target => `No hay copia local de ${target}, así que no sé qué commits quitaría. Haz antes git fetch.`,
  pushNoLoss: target => `forzaría la subida a ${target}: no quitaría ningún commit`,
  pushDrops: (target, n) => `forzaría la subida a ${target}: quitaría ${es(n, 'commit', 'commits')}`,
  pushNote: (target, source) => `Commits de ${target} que ${source} no tiene, según el último fetch.`,
  migrateUnknownTool: 'ejecutaría migraciones',
  migrateUnknownToolNote: 'No sé listar las migraciones pendientes de esta herramienta.',
  migrateFailed: command => `ejecutaría ${command}`,
  migrateFailedNote: argv => `No he podido listar las migraciones pendientes (falló ${argv}).`,
  migrateNothing: command => `ejecutaría ${command}: no hay nada pendiente`,
  migratePending: n => `aplicaría ${es(n, 'migración pendiente', 'migraciones pendientes')}`,
  accordingTo: argv => `Según ${argv}.`,
  remote: source => `ejecutaría un instalador descargado de ${source ?? 'internet'}`,
  remoteNote: 'Es un script de internet que se ejecuta con tus permisos sin guardarse antes, así que no se puede revisar lo que hará. Si dudas, ábrelo antes en el navegador.',
  installs: (action, what, scope) => `${action === 'update' ? 'actualizaría' : 'instalaría'} ${what} ${scope}`,
  thirdParty: 'software de terceros',
  packages: n => es(n, 'paquete', 'paquetes'),
  pkg: p => (p.from === 'requirements' ? `los requisitos de ${p.name}` : p.from === 'editable' ? `${p.name} (editable)` : p.from === 'path' ? `la carpeta ${p.name}` : p.name),
  alreadyInstalled: (pkg, version) => `${pkg} (ya instalado: ${version})`,
  newPackage: pkg => `${pkg} (nuevo)`,
  noVenv: 'No veo un entorno virtual activo.',
  installNote: 'Queda fuera del proyecto, para todas tus sesiones, y es código de terceros que se ejecuta con tus permisos (también al instalarse). Comprueba el nombre exacto y de dónde viene.',
  scope: risk => {
    switch (risk.scope) {
      case 'js-global': return `en el ${risk.manager} global de tu usuario`
      case 'python-tool': return 'como herramienta de Python de tu usuario'
      case 'python-system': return 'en el Python del sistema'
      case 'python-user': return 'en el Python de tu usuario'
      case 'python-outside-venv': return 'en el Python del sistema o de tu usuario, fuera de un entorno virtual'
      case 'machine': return `en el equipo (${risk.via})`
      case 'system': return `en el sistema (${risk.via})`
      case 'user-manager': return `para tu usuario (${risk.via})`
      case 'ruby-gems': return 'en las gemas de Ruby de tu usuario o del sistema'
      case 'cargo-bin': return 'en ~/.cargo/bin, para tu usuario'
      case 'go-bin': return 'en la carpeta bin de Go, para tu usuario'
      case 'volta': return 'como herramienta de Volta para tu usuario'
      case 'nvm': return 'como versión de Node para tu usuario'
      case 'powershell-user': return 'en los módulos de PowerShell de tu usuario'
      case 'powershell-all-users': return 'para todos los usuarios del equipo'
      case 'editor': return `en ${risk.via}, para tu usuario`
      case 'claude-plugin': return 'en Claude Code, para tu usuario'
      case 'claude-mcp-user': return 'como servidor MCP de Claude Code para tu usuario'
      case 'deno-global': return 'como herramienta global de Deno'
      case 'dotnet-global': return 'como herramienta global de .NET'
      case 'remote': return 'con lo que decida el instalador'
    }
  },
} satisfies Words

const WORDS: Record<Lang, Words> = { en: EN, es: ES }

export function words(lang: Lang): Words {
  return WORDS[lang]
}

// ---------------------------------------------------------------------------
// Reports

const listed = (items: string[]) => ({ lines: items.slice(0, LIST_MAX), more: Math.max(0, items.length - LIST_MAX) })

/** What the panel says about a risk, from what was measured. */
export function report(risk: Risk, facts: Facts, lang: Lang): Report {
  const t = WORDS[lang]
  switch (facts.kind) {
    case 'unmeasured':
      return facts.reason === 'missing-dir'
        ? { summary: t.inDir(risk.command, facts.detail), lines: [], more: 0, note: t.missingDir(facts.detail) }
        : { summary: t.unmeasured(risk.command), lines: [], more: 0, note: t.unmeasuredNote(facts.detail) }
    case 'delete': {
      const targets = facts.targets.join(' ')
      if (facts.targets.length === 0) return { summary: t.deleteNoTargets(risk.command), lines: [], more: 0, note: t.deleteNoTargetsNote }
      if (facts.found === 0) return { summary: t.deleteMissing(targets), lines: [], more: 0, note: t.deleteMissingNote }
      if (facts.files === 0) return { summary: t.deleteEmptyDirs(facts.found), lines: [], more: 0, note: t.paths(targets) }
      return {
        summary: t.deleteFiles(facts.files, formatSize(facts.bytes, lang), facts.truncated),
        lines: facts.sample.slice(0, LIST_MAX),
        more: Math.max(0, facts.files - Math.min(facts.sample.length, LIST_MAX)),
        note: facts.truncated ? t.stoppedCounting(t.paths(targets)) : t.paths(targets),
      }
    }
    case 'clean':
      if (!facts.ok) return { summary: t.cleanFailed, lines: [], more: 0, note: facts.error }
      return { summary: facts.paths.length === 0 ? t.cleanNothing : t.cleanPaths(facts.paths.length), ...listed(facts.paths), note: t.cleanNote }
    case 'discard': {
      if (!facts.ok) return { summary: t.notARepo(risk.command), lines: [], more: 0, note: facts.error }
      const files = facts.files.length
      const commits = facts.commits.length
      const summary =
        files > 0 && commits > 0 ? t.discardFilesAndCommits(files, commits) : commits > 0 ? t.dropCommits(commits) : files > 0 ? t.discardFiles(files) : t.discardNothing
      const note = [facts.shortstat ? t.discardNote(facts.shortstat) : t.statusNote, commits > 0 ? t.reflogNote : ''].filter(Boolean).join(' ')
      return { summary, ...listed([...facts.files, ...facts.commits]), note }
    }
    case 'push':
      if (!facts.known) return { summary: t.pushTo(facts.target), lines: [], more: 0, note: t.pushUnknown(facts.target) }
      return {
        summary: facts.commits.length === 0 ? t.pushNoLoss(facts.target) : t.pushDrops(facts.target, facts.commits.length),
        ...listed(facts.commits),
        note: t.pushNote(facts.target, facts.source),
      }
    case 'migrate': {
      if (facts.argv === null) return { summary: t.migrateUnknownTool, lines: [], more: 0, note: t.migrateUnknownToolNote }
      const argv = facts.argv.join(' ')
      if (!facts.ok) return { summary: t.migrateFailed(risk.command), lines: [], more: 0, note: t.migrateFailedNote(argv) }
      return {
        summary: facts.pending.length === 0 ? t.migrateNothing(risk.command) : t.migratePending(facts.pending.length),
        ...listed(facts.pending),
        note: t.accordingTo(argv),
      }
    }
    case 'install': {
      if (risk.kind !== 'install') return { summary: risk.command, lines: [], more: 0, note: '' }
      if (risk.scope === 'remote') return { summary: t.remote(risk.source), lines: [], more: 0, note: t.remoteNote }
      const names = risk.packages.map(t.pkg)
      const lines = risk.packages.map((p, i) => {
        const name = names[i] ?? p.name
        if (facts.installed === null) return name
        const version = installedVersion(facts.installed, p.name)
        return version ? t.alreadyInstalled(name, version) : t.newPackage(name)
      })
      const what = names.length === 0 ? t.thirdParty : names.length === 1 ? (names[0] ?? '') : t.packages(names.length)
      return {
        summary: t.installs(risk.action, what, t.scope(risk)),
        ...listed(lines),
        note: [risk.venvDependent ? t.noVenv : '', t.installNote].filter(Boolean).join(' '),
      }
    }
  }
}

/** What Claude reads when the command does not run. */
export function denyReason(reason: Reason, effect: string, lang: Lang): string {
  const t = WORDS[lang]
  return t.deny(t.reasons[reason], effect)
}
