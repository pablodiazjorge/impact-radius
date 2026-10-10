// impact-radius: holds a risky shell command (recursive deletes, git reset --hard, git clean, force
// pushes, discarded changes, migrations and third-party installs for the whole user or system),
// shows what it would change and waits for the person to press Run or Cancel.
//
// It measures with $.fs and git, never bash, so it works the same on Windows. To hold the command,
// the hook waits inside a short `$.process.run` (time spent inside a `$` call doesn't count against
// the hook's budget, except `$.clock.sleep`): `sleep` on Linux and macOS; on Windows, Git for
// Windows' `sleep.exe` or, without it, PowerShell's `Start-Sleep`.

import type { EngineInterface, RenderElement, RenderInput, Register } from 'claude-code'

import { classify, type Risk } from './classify'
import { type Facts, measure, type Probe } from './measure'
import { denyReason, type Lang, langOf, type Reason, type Report, report, words } from './messages'
import { resolvePath, type Shell } from './shell'

const PANE = 'impact-radius'
const WAIT_MAX_MS = 10 * 60 * 1000

type Decision = 'run' | Reason
type Held = {
  command: string
  risks: Risk[]
  report: Report | null
  decision: Decision | null
  place: 'pane' | 'band'
}

let lang: Lang = 'en'
// The held command, or null. One at a time: a turn's commands come one after another, and a
// subagent's waits for the answer to the one before.
let held: Held | null = null
let sleepArgv: Promise<string[]> | null = null
let windows: Promise<boolean> | null = null

// ---------------------------------------------------------------------------
// Environment

function isWindows($: EngineInterface): Promise<boolean> {
  windows ??= (async () => (await $.env.get('OS')) === 'Windows_NT')()
  return windows
}

async function homeOf($: EngineInterface): Promise<string> {
  return ((await $.env.get('USERPROFILE')) || (await $.env.get('HOME')) || '').replace(/\\/g, '/')
}

/** How to wait a moment without spending the hook's budget. */
async function findSleep($: EngineInterface): Promise<string[]> {
  if (!(await isWindows($))) return ['sleep', '0.25']
  try {
    const run = await $.process.run(['git', '--exec-path'], { timeoutMs: 5_000 })
    const path = run.stdout.trim().replace(/\\/g, '/')
    const root = path.replace(/\/(mingw64|mingw32|clangarm64)\/libexec\/git-core\/?$/i, '')
    const sleep = `${root}/usr/bin/sleep.exe`
    if (run.exitCode === 0 && root !== path && (await $.fs.exists(sleep))) return [sleep, '0.25']
  } catch {
    // no Git for Windows: PowerShell is always there
  }
  return ['powershell', '-NoProfile', '-NonInteractive', '-Command', 'Start-Sleep -Milliseconds 300']
}

async function pause($: EngineInterface): Promise<void> {
  sleepArgv ??= findSleep($)
  await $.process.run(await sleepArgv, { timeoutMs: 5_000 })
}

/** Whether the session runs inside a Python virtual environment (not conda's `base`). */
async function inVirtualEnv($: EngineInterface): Promise<boolean> {
  if (await $.env.get('VIRTUAL_ENV')) return true
  return Boolean(await $.env.get('CONDA_PREFIX')) && (await $.env.get('CONDA_DEFAULT_ENV')) !== 'base'
}

/** The real folder of a `cd`, or null when it doesn't exist. */
async function realDir($: EngineInterface, base: string, dir: string): Promise<string | null> {
  if (dir === '-') return null // `cd -` depends on the shell's history
  const path = resolvePath(base, dir, await homeOf($))
  try {
    return (await $.fs.stat(path)).kind === 'dir' ? path : null
  } catch {
    return null
  }
}

/** The engine calls measure.ts needs, so `$` never leaves this file. */
async function probe($: EngineInterface): Promise<Probe> {
  return {
    windows: await isWindows($),
    home: await homeOf($),
    now: () => $.clock.now(),
    stat: path => $.fs.stat(path).then(
      s => s,
      () => null,
    ),
    list: path => $.fs.list(path).then(
      l => [...l],
      () => null,
    ),
    run: (argv, options) =>
      $.process.run(argv, options).then(
        r => ({ exitCode: r.exitCode, stdout: r.stdout, stderr: r.stderr }),
        () => ({ exitCode: -1, stdout: '', stderr: '' }),
      ),
  }
}

const commandOf = (input: unknown) => String((input as { command?: unknown } | undefined)?.command ?? '')
const shellOf = (tool: string): Shell => (tool === 'Bash' ? 'bash' : 'powershell')

/** The effect Claude reads: the first risk's, and the other risky commands of the line. */
function effectOf(entry: Held): string {
  const others = [...new Set(entry.risks.slice(1).map(r => r.command))]
  const summary = entry.report?.summary ?? entry.risks[0]?.command ?? ''
  return others.length > 0 ? `${summary} (${words(lang).also(others.join(', '))})` : summary
}

// ---------------------------------------------------------------------------
// Drawing

/** What another mod draws under the band; the engine's marker (`type: 'engine'`) doesn't count. */
const drawnBelow = (tree: unknown): RenderElement | null =>
  typeof tree === 'object' && tree !== null && (tree as { type?: unknown }).type !== 'engine' ? (tree as RenderElement) : null

// All text is in the theme's text color, the only one that keeps 7:1 contrast in every theme;
// color goes to the border and the icons.
function draw($: EngineInterface, e: RenderInput, entry: Held, below: RenderElement | null = null) {
  const { Box, Text, Button } = $.ui.resolve(e)
  const t = words(lang)
  const first = entry.risks[0]?.command ?? ''
  const r = entry.report ?? { summary: first, lines: [], more: 0, note: '' }
  const others = [...new Set(entry.risks.slice(1).map(x => x.command))]
  const width = Math.max(t.command.length, t.effect.length) + 2
  // The buttons answer for the command they were drawn for, never for whichever is held now.
  const decide = (d: Decision) => () => {
    if (entry.decision === null) entry.decision = d
  }
  // The terminal shows a hotkey only on a plain button; the desktop draws native ones.
  const terminal = e.surface === 'terminal'
  const panel = (
    <Box flexDirection="column" borderStyle="round" borderColor="warning" paddingX={1}>
      <Text bold>
        <Text color="warning">{'⚠ '}</Text>
        {`${t.name}: ${first}`}
      </Text>
      <Box flexDirection="column" marginTop={1}>
        <Text wrap="truncate-end">
          <Text bold>{t.command.padEnd(width)}</Text>
          {entry.command}
        </Text>
        <Text>
          <Text bold>{t.effect.padEnd(width)}</Text>
          <Text color="error">{'● '}</Text>
          <Text bold>{r.summary}</Text>
        </Text>
      </Box>
      {r.lines.length > 0 ? (
        <Box flexDirection="column" marginTop={1}>
          {r.lines.map((line, i) => (
            <Text key={`line-${i}`} wrap="truncate-end">
              {`  ${line}`}
            </Text>
          ))}
          {r.more > 0 && <Text>{`  ${t.more(r.more)}`}</Text>}
        </Box>
      ) : null}
      {r.note ? (
        <Box marginTop={1}>
          <Text wrap="wrap">{r.note}</Text>
        </Box>
      ) : null}
      {others.length > 0 ? <Text wrap="wrap">{t.also(others.join(', '))}</Text> : null}
      <Box flexDirection="row" marginTop={1} gap={2}>
        {terminal ? (
          <Button key="cancel" plain label={t.cancel} hotkey={t.cancelKey} autoFocus onPress={decide('cancel')} />
        ) : (
          <Button key="cancel" variant="primary" label={t.cancel} hotkey={t.cancelKey} autoFocus onPress={decide('cancel')} />
        )}
        {terminal ? (
          <Button key="run" plain label={t.run} hotkey={t.runKey} onPress={decide('run')} />
        ) : (
          <Button key="run" label={t.run} hotkey={t.runKey} onPress={decide('run')} />
        )}
        <Text>{t.waiting}</Text>
      </Box>
    </Box>
  )
  return below ? (
    <Box flexDirection="column">
      {panel}
      {below}
    </Box>
  ) : (
    panel
  )
}

// ---------------------------------------------------------------------------
// Hooks

export const register: Register = (on, options) => {
  lang = langOf(options?.language)

  // Held at the permission check (`tool.check`), not at the run: the person's answer is the
  // permission, so the engine doesn't ask again after Run.
  on('tool.check', async ($, e, next) => {
    if (e.tool !== 'Bash' && e.tool !== 'PowerShell') return next(e)
    // Another plugin's `$.tool.check` is not a command about to run.
    if (!e.tool_use_id) return next(e)
    const command = commandOf(e.input)
    let risks = classify(command, shellOf(e.tool))
    // pip without `--user` inside a virtual environment installs into the project.
    const venvDependent = (r: Risk) => r.kind === 'install' && r.venvDependent === true
    if (risks.some(venvDependent) && (await inVirtualEnv($))) risks = risks.filter(r => !venvDependent(r))
    const first = risks[0]
    if (first === undefined) return next(e)
    // When the person's rules already forbid it, there is nothing to ask.
    const verdict = await next(e)
    if (verdict.decision === 'deny') return verdict
    // Nobody can press anything (a plain `claude -p`): don't wait ten minutes for it.
    if ((await $.session.surfaces()).length === 0) return { decision: 'deny', reason: denyReason('nobody', first.command, lang) }

    // One held command at a time: another one (a subagent's, say) waits for its answer.
    // `held` is checked and taken with no await in between.
    while (held !== null) {
      if (next.signal.aborted) return { decision: 'deny', reason: denyReason('interrupted', first.command, lang) }
      await pause($)
    }
    const mine: Held = { command, risks, report: null, decision: null, place: 'pane' }
    held = mine

    let placed = false
    try {
      const base = (await $.session.cwd()).replace(/\\/g, '/')
      const cwd = first.dir ? await realDir($, base, first.dir) : base
      const facts: Facts = cwd === null ? { kind: 'unmeasured', reason: 'missing-dir', detail: first.dir ?? '' } : await measure(first, cwd, await probe($))
      mine.report = report(first, facts, lang)

      const opened = await $.ui.open({ id: PANE, title: words(lang).name, focus: true })
      placed = opened.isPlaced
      if (!placed) mine.place = 'band'
      $.ui.invalidate('ui.render')

      const start = await $.clock.now()
      while (mine.decision === null) {
        if (next.signal.aborted) {
          mine.decision = 'interrupted'
          break
        }
        if ((await $.clock.now()) - start > WAIT_MAX_MS) {
          mine.decision = 'timeout'
          break
        }
        await pause($)
      }
    } catch {
      mine.decision = 'error' // anything unexpected leaves the command unrun
    } finally {
      // Close this command's pane before letting go, so the next one's isn't closed.
      try {
        if (placed) await $.ui.close({ id: PANE })
      } catch {
        // already closed
      }
      if (held === mine) held = null
      $.ui.invalidate('ui.render')
    }

    const t = words(lang)
    if (mine.decision === 'run') {
      $.ui.toast(`${t.name}: ${t.ran}`)
      return { decision: 'allow', reason: `${t.name}: ${t.allowed}` }
    }
    return { decision: 'deny', reason: denyReason(mine.decision ?? 'error', effectOf(mine), lang) }
  }).catch(($, e, next) => {
    if (e.tool !== 'Bash' && e.tool !== 'PowerShell') return next(e)
    // Not run: the call came in beneath one this hook is holding. Only a risky one is stopped.
    if (next.error.kind === 're-entry') {
      const risks = e.tool_use_id ? classify(commandOf(e.input), shellOf(e.tool)) : []
      const first = risks[0]
      return first === undefined ? next(e) : { decision: 'deny', reason: denyReason('busy', first.command, lang) }
    }
    // A guard that fails doesn't let the command through.
    return { decision: 'deny', reason: denyReason('error', words(lang).notMeasured, lang) }
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, ($, e, next) => {
    if (held === null || held.report === null) return next(e)
    return draw($, e, held)
  })

  // When the screen can't place the pane (a narrow terminal), the notice goes above the prompt.
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const entry = held
    if (entry === null || entry.report === null || entry.place !== 'band' || e.props.hasSurvey) return next(e)
    return draw($, e, entry, drawnBelow(await next(e)))
  })
}
