import { describe, expect, mock, test } from 'claude-code/testing'
import type { MockClock } from 'claude-code/testing'
import type { On } from 'claude-code'

import { denyReason } from '../hooks/messages'

const PANE = 'impact-radius'
const GIT_SLEEP = 'C:/Program Files/Git/usr/bin/sleep.exe'

const PANE_PROPS = {
  title: 'Impact radius',
  isFocused: true,
  bodyColumns: 80,
  placement: 'dock' as const,
  scroll: { offset: 0, bodyRows: 30 },
  view: {},
}

const BAND_PROPS = {
  hasSurvey: false,
  isWorking: true,
  maxRows: 12,
  bodyColumns: 100,
  scroll: { offset: 0, bodyRows: 12 },
  view: {},
}

type Node = { kind: 'file' | 'dir'; size?: number }
type Output = { stdout?: string; stderr?: string; exitCode?: number }

type WorldOptions = {
  windows?: boolean
  /** Whether the screen places the pane. */
  places?: boolean
  files?: Record<string, Node>
  git?: Record<string, Output>
  /** Other processes, by their whole command (`npm.cmd ls -g --depth=0 --json`). */
  others?: Record<string, Output>
  env?: Record<string, string>
  /** What the engine would decide on its own (rules and mode). */
  verdict?: 'allow' | 'ask' | 'deny'
  /** The surfaces the session draws on; empty in a plain `claude -p`. */
  surfaces?: ('terminal' | 'desktop')[]
}

/** The permission check of a real call from Claude to the shell (it carries an id). */
const call = (tool: 'Bash' | 'PowerShell', command: string) => ({ tool, input: { command }, tool_use_id: `tu-${command.length}` }) as never

const ok = (output: Output = {}) => ({
  value: {
    exitCode: output.exitCode ?? 0,
    stdout: output.stdout ?? '',
    stderr: output.stderr ?? '',
    isStdoutTruncated: false,
    isStderrTruncated: false,
  },
})

/** Just enough engine: environment, files, processes, panes and its permission verdict. */
const world = (on: On, options: WorldOptions = {}) => {
  const windows = options.windows ?? true
  mock.env(on, { ...(windows ? { OS: 'Windows_NT', USERPROFILE: 'C:\\Users\\me' } : { HOME: '/home/me' }), ...options.env })
  mock.store(on)
  const clock = mock.clock(on, { now: Date.UTC(2026, 9, 9, 13, 0) })
  const processes: string[][] = []
  const opened: string[] = []
  const closed: string[] = []
  const files = new Map(Object.entries(options.files ?? {}))
  const node = (path: string, n: Node) => ({ name: path.slice(path.lastIndexOf('/') + 1), kind: n.kind, size: n.size ?? 0, mtimeMs: 0, isLink: false })

  on('session.cwd', () => ({ value: windows ? 'C:\\project' : '/home/me/project' }))
  on('session.surfaces', () => ({ value: options.surfaces ?? ['desktop'] }))
  // The engine hands paths over with the system's slashes.
  const key = (path: string) => path.replace(/\\/g, '/')
  on('fs.stat', ($, e) => {
    const n = files.get(key(e.path))
    if (!n) throw new Error(`ENOENT: ${e.path}`)
    return { value: node(e.path, n) as never }
  })
  on('fs.list', ($, e) => {
    const dir = key(e.path).replace(/\/$/, '')
    return { value: [...files].filter(([path]) => path.slice(0, path.lastIndexOf('/')) === dir).map(([path, n]) => node(path, n)) as never }
  })
  on('fs.exists', ($, e) => ({ value: key(e.path) === GIT_SLEEP || files.has(key(e.path)) }))
  on('process.run', async ($, e) => {
    const argv = [...e.argv]
    processes.push(argv)
    if (argv[0] === 'git' && argv[1] === '--exec-path') return ok({ stdout: 'C:/Program Files/Git/mingw64/libexec/git-core\n' })
    if (argv[0] === GIT_SLEEP || argv[0] === 'sleep' || argv[0] === 'powershell') {
      await clock.sleep(250)
      return ok()
    }
    const other = options.others?.[argv.join(' ')]
    if (other) return ok(other)
    if (argv[0] === 'git') return ok(options.git?.[argv.slice(1).join(' ')] ?? {})
    return ok({ exitCode: 1, stderr: 'not found' })
  })
  on('ui.open', ($, e) => {
    opened.push(e.id)
    return { value: (options.places === false ? { isPlaced: false, reason: 'narrow terminal' } : { isPlaced: true }) as never }
  })
  on('ui.close', ($, e) => {
    closed.push(e.id)
    return { value: undefined }
  })
  on('ui.invalidate', () => ({ value: undefined }))
  on('ui.toast', () => ({ value: undefined }))
  // Under the band, what the test draws or the engine's marker.
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    try {
      return await next(e)
    } catch {
      return { type: 'engine', ref: 'engine' } as never
    }
  })
  on('tool.check', () => ({ decision: options.verdict ?? 'ask' }))
  return { processes, opened, closed, clock }
}

/** Lets the hook, which runs alongside the test, get to where it is expected. */
const until = async (clock: MockClock, condition: () => boolean) => {
  for (let i = 0; i < 50 && !condition(); i++) await clock.settle()
  expect(condition()).toBe(true)
}

const BUILD: Record<string, Node> = {
  'C:/project/build': { kind: 'dir' },
  'C:/project/build/a.js': { kind: 'file', size: 1000 },
  'C:/project/build/sub': { kind: 'dir' },
  'C:/project/build/sub/b.js': { kind: 'file', size: 2048 },
}

describe('impact-radius', () => {
  test('holds a Remove-Item -Recurse, shows what it would delete, and Run allows it with no second question', async ($, on) => {
    const w = world(on, { files: BUILD })
    const pending = $.tool.check(call('PowerShell', 'Remove-Item -Recurse -Force build'))
    await until(w.clock, () => w.opened.length > 0)

    const pane = await $.ui.mount({ plugin: 'impact-radius', surface: 'desktop', component: 'Pane', requestId: PANE, props: PANE_PROPS })
    expect(await pane.find({ type: 'Text', text: 'deletes 2 files (3.0\u00a0KB)' })).toBeDefined()
    expect(await pane.find({ type: 'Text', text: '  build/sub/b.js' })).toBeDefined()
    await pane.press({ key: 'run' })
    await w.clock.advance(300)

    // "allow", not "ask": the engine doesn't ask again after Run.
    const result = await pending
    expect(result.decision).toBe('allow')
    expect(w.closed).toEqual([PANE])
    // On Windows it waits with Git's sleep.exe and measures without bash (the one on PATH is WSL's).
    expect(w.processes.some(p => p[0] === GIT_SLEEP)).toBe(true)
    expect(w.processes.some(p => p[0] === 'bash')).toBe(false)
    await pane.unmount()
  })

  test('Cancel leaves the command unrun and tells Claude why', async ($, on) => {
    const w = world(on, {
      git: {
        'status --porcelain': { stdout: ' M a.ts\nM  b.ts\n?? new.txt\n' },
        'diff --shortstat HEAD': { stdout: ' 2 files changed, 3 insertions(+), 1 deletion(-)\n' },
      },
    })
    const pending = $.tool.check(call('Bash', 'git reset --hard'))
    await until(w.clock, () => w.opened.length > 0)
    const pane = await $.ui.mount({ plugin: 'impact-radius', surface: 'terminal', component: 'Pane', requestId: PANE, props: PANE_PROPS })
    expect(await pane.find({ type: 'Text', text: '   M a.ts' })).toBeDefined()
    await pane.press({ key: 'cancel' })
    await w.clock.advance(300)
    const result = await pending
    expect(result.decision).toBe('deny')
    expect(result.reason).toBe(denyReason('cancel', 'discards uncommitted changes in 2 files', 'en'))
    await pane.unmount()
  })

  test('the buttons: Cancel first and focused; plain with hotkeys on the terminal, native with Cancel primary on the desktop', async ($, on) => {
    const w = world(on, { files: BUILD })
    const pending = $.tool.check(call('PowerShell', 'Remove-Item -Recurse build'))
    await until(w.clock, () => w.opened.length > 0)
    for (const surface of ['terminal', 'desktop'] as const) {
      const pane = await $.ui.mount({ plugin: 'impact-radius', surface, component: 'Pane', requestId: PANE, props: PANE_PROPS })
      const buttons = await pane.findAll({ type: 'Button' })
      expect(buttons.map(b => b.key)).toEqual(['cancel', 'run'])
      expect(buttons[0]?.props).toMatchObject({ label: 'Cancel', hotkey: 'c', autoFocus: true, ...(surface === 'terminal' ? { plain: true } : { variant: 'primary' }) })
      expect(buttons[1]?.props).toMatchObject({ label: 'Run', hotkey: 'r' })
      await pane.unmount()
    }
    const pane = await $.ui.mount({ plugin: 'impact-radius', surface: 'desktop', component: 'Pane', requestId: PANE, props: PANE_PROPS })
    await pane.press({ key: 'cancel' })
    await w.clock.advance(300)
    expect((await pending).decision).toBe('deny')
    await pane.unmount()
  })

  test('what is not risky and other plugins checks pass without opening anything', async ($, on) => {
    const w = world(on)
    expect((await $.tool.check(call('PowerShell', 'git status; Get-ChildItem build'))).decision).toBe('ask')
    expect((await $.tool.check({ tool: 'Read', input: { file_path: 'C:\\project\\a.ts' }, tool_use_id: 'tu-r' } as never)).decision).toBe('ask')
    // A check (`$.tool.check` with no call id) is not a command about to run.
    expect((await $.tool.check({ tool: 'PowerShell', input: { command: 'Remove-Item -Recurse build' } } as never)).decision).toBe('ask')
    expect(w.opened).toEqual([])
  })

  test('when the rules already forbid it, it asks nothing', async ($, on) => {
    const w = world(on, { verdict: 'deny', files: BUILD })
    expect((await $.tool.check(call('PowerShell', 'Remove-Item -Recurse build'))).decision).toBe('deny')
    expect(w.opened).toEqual([])
  })

  test('one held command at a time: a second risky call waits for the first answer; a harmless one passes', async ($, on) => {
    const w = world(on, { files: BUILD, git: { 'clean -n -d --': { stdout: 'Would remove tmp/\n' } } })
    const first = $.tool.check(call('PowerShell', 'Remove-Item -Recurse build'))
    await until(w.clock, () => w.opened.length > 0)
    expect((await $.tool.check(call('Bash', 'git status'))).decision).toBe('ask')
    const second = $.tool.check(call('Bash', 'git clean -fd'))
    const pane = await $.ui.mount({ plugin: 'impact-radius', surface: 'terminal', component: 'Pane', requestId: PANE, props: PANE_PROPS })
    expect(await pane.find({ type: 'Text', text: 'deletes 2 files (3.0\u00a0KB)' })).toBeDefined()
    expect(w.opened).toHaveLength(1)
    await pane.press({ key: 'cancel' })
    await w.clock.advance(300)
    expect((await first).decision).toBe('deny')
    await until(w.clock, () => w.opened.length === 2)
    await pane.unmount()
    const next = await $.ui.mount({ plugin: 'impact-radius', surface: 'terminal', component: 'Pane', requestId: PANE, props: PANE_PROPS })
    expect(await next.find({ type: 'Text', text: 'removes 1 untracked path' })).toBeDefined()
    await next.press({ key: 'run' })
    await w.clock.advance(300)
    expect((await second).decision).toBe('allow')
    await next.unmount()
  })

  test('with nobody to answer (a plain claude -p) it denies at once instead of waiting', async ($, on) => {
    const w = world(on, { surfaces: [], files: BUILD })
    const result = await $.tool.check(call('PowerShell', 'Remove-Item -Recurse build'))
    expect(result.decision).toBe('deny')
    expect(result.reason).toBe(denyReason('nobody', 'Remove-Item -Recurse', 'en'))
    expect(w.opened).toEqual([])
  })

  test('when the screen does not place the pane, the notice goes above the prompt, over what other mods draw', async ($, on) => {
    on('ui.render', { component: 'AbovePrompt' }, ($, e) => {
      const { Text } = $.ui.resolve(e)
      return h(Text, null, 'Notebook band') as never
    })
    const w = world(on, { places: false, files: BUILD })
    const pending = $.tool.check(call('PowerShell', 'rm -r -fo build'))
    await until(w.clock, () => w.opened.length > 0)
    const band = await $.ui.mount({ plugin: 'impact-radius', surface: 'desktop', component: 'AbovePrompt', props: BAND_PROPS })
    expect(await band.find({ type: 'Text', text: 'deletes 2 files (3.0\u00a0KB)' })).toBeDefined()
    expect(await band.find({ type: 'Text', text: 'Notebook band' })).toBeDefined()
    await band.press({ key: 'cancel' })
    await w.clock.advance(300)
    expect((await pending).reason).toContain('the user pressed Cancel')
    expect(w.closed).toEqual([])
    await band.unmount()
  })

  test('the other risky commands of the line are named, and Claude reads them too', async ($, on) => {
    const w = world(on, { files: BUILD })
    const pending = $.tool.check(call('PowerShell', 'Remove-Item -Recurse build; git push --force'))
    await until(w.clock, () => w.opened.length > 0)
    const pane = await $.ui.mount({ plugin: 'impact-radius', surface: 'terminal', component: 'Pane', requestId: PANE, props: PANE_PROPS })
    expect(await pane.find({ type: 'Text', text: 'Also in this command: git push --force' })).toBeDefined()
    await pane.press({ key: 'cancel' })
    await w.clock.advance(300)
    expect((await pending).reason).toContain('deletes 2 files (3.0\u00a0KB) (Also in this command: git push --force)')
    await pane.unmount()
  })

  test('holds an npm install -g and marks which packages are already installed', async ($, on) => {
    const w = world(on, {
      others: { 'npm.cmd ls -g --depth=0 --json': { stdout: JSON.stringify({ dependencies: { typescript: { version: '5.6.2' } } }) } },
    })
    const pending = $.tool.check(call('PowerShell', 'npm install -g typescript@5.7 eslint'))
    await until(w.clock, () => w.opened.length > 0)
    const pane = await $.ui.mount({ plugin: 'impact-radius', surface: 'desktop', component: 'Pane', requestId: PANE, props: PANE_PROPS })
    expect(await pane.find({ type: 'Text', text: "installs 2 packages in your user's global npm" })).toBeDefined()
    expect(await pane.find({ type: 'Text', text: '  typescript@5.7 (already installed: 5.6.2)' })).toBeDefined()
    expect(await pane.find({ type: 'Text', text: '  eslint (new)' })).toBeDefined()
    await pane.press({ key: 'cancel' })
    await w.clock.advance(300)
    expect((await pending).reason).toBe(denyReason('cancel', "installs 2 packages in your user's global npm", 'en'))
    await pane.unmount()
  })

  test('an installer from the internet run without saving it shows where it comes from', async ($, on) => {
    const w = world(on)
    const pending = $.tool.check(call('PowerShell', 'irm https://example.org/install.ps1 | iex'))
    await until(w.clock, () => w.opened.length > 0)
    const pane = await $.ui.mount({ plugin: 'impact-radius', surface: 'terminal', component: 'Pane', requestId: PANE, props: PANE_PROPS })
    expect(await pane.find({ type: 'Text', text: 'runs an installer downloaded from https://example.org/install.ps1' })).toBeDefined()
    await pane.press({ key: 'run' })
    await w.clock.advance(300)
    expect((await pending).decision).toBe('allow')
    await pane.unmount()
  })

  test('project dependencies and pip inside a virtual environment pass without opening anything', async ($, on) => {
    const w = world(on, { env: { VIRTUAL_ENV: 'C:\\project\\.venv' } })
    expect((await $.tool.check(call('Bash', 'npm install eslint --save-dev'))).decision).toBe('ask')
    expect((await $.tool.check(call('Bash', 'pip install requests'))).decision).toBe('ask')
    expect(w.opened).toEqual([])
    // With --user the environment doesn't matter: it goes to the user's Python.
    const pending = $.tool.check(call('Bash', 'pip install --user requests'))
    await until(w.clock, () => w.opened.length > 0)
    const pane = await $.ui.mount({ plugin: 'impact-radius', surface: 'terminal', component: 'Pane', requestId: PANE, props: PANE_PROPS })
    expect(await pane.find({ type: 'Text', text: "installs requests in your user's Python" })).toBeDefined()
    await pane.press({ key: 'cancel' })
    await w.clock.advance(300)
    expect((await pending).decision).toBe('deny')
    await pane.unmount()
  })

  test('on Linux and macOS it waits with sleep; a path that does not exist is said', async ($, on) => {
    const w = world(on, { windows: false })
    const pending = $.tool.check(call('Bash', 'rm -rf /home/me/project/missing'))
    await until(w.clock, () => w.opened.length > 0)
    const pane = await $.ui.mount({ plugin: 'impact-radius', surface: 'terminal', component: 'Pane', requestId: PANE, props: PANE_PROPS })
    expect(await pane.find({ type: 'Text', text: "deletes nothing: /home/me/project/missing doesn't exist" })).toBeDefined()
    await pane.press({ key: 'run' })
    await w.clock.advance(300)
    expect((await pending).decision).toBe('allow')
    expect(w.processes.some(p => p[0] === 'sleep')).toBe(true)
    expect(w.processes.some(p => p[0] === 'git')).toBe(false)
    await pane.unmount()
  })
})

describe('impact-radius in Spanish', () => {
  test('with Language set to Español, the panel and what Claude reads are in Spanish', { options: { language: 'Español' } }, async ($, on) => {
    const w = world(on, { files: BUILD })
    const pending = $.tool.check(call('PowerShell', 'Remove-Item -Recurse -Force build'))
    await until(w.clock, () => w.opened.length > 0)
    const pane = await $.ui.mount({ plugin: 'impact-radius', surface: 'terminal', component: 'Pane', requestId: PANE, props: PANE_PROPS })
    expect(await pane.find({ type: 'Text', text: 'borraría 2 archivos (3,0\u00a0KB)' })).toBeDefined()
    expect((await pane.findAll({ type: 'Button' })).map(b => [b.props.label, b.props.hotkey])).toEqual([
      ['Cancelar', 'c'],
      ['Ejecutar', 'e'],
    ])
    await pane.press({ key: 'cancel' })
    await w.clock.advance(300)
    expect((await pending).reason).toBe(denyReason('cancel', 'borraría 2 archivos (3,0\u00a0KB)', 'es'))
    await pane.unmount()
  })
})
