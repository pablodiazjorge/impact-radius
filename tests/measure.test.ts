import { describe, expect, test } from 'claude-code/testing'

import { classify, type Risk } from '../hooks/classify'
import { cleanDryRunArgs, measure, type Probe, resetTarget, type Run } from '../hooks/measure'

const risk = (command: string): Risk => {
  const r = classify(command, 'bash')[0]
  if (r === undefined) throw new Error(`not risky: ${command}`)
  return r
}

/** A Probe over a few files and canned git answers; it records every process it runs. */
function fakeProbe(files: Record<string, number | 'dir'> = {}, git: Record<string, Partial<Run>> = {}) {
  const runs: { argv: string[]; env?: Record<string, string> }[] = []
  const probe: Probe = {
    windows: false,
    home: '/home/me',
    now: async () => 0,
    stat: async path => {
      const f = files[path]
      return f === undefined ? null : { kind: f === 'dir' ? 'dir' : 'file', size: f === 'dir' ? 0 : f, isLink: false }
    },
    list: async dir =>
      Object.entries(files)
        .filter(([path]) => path.slice(0, path.lastIndexOf('/')) === dir)
        .map(([path, f]) => ({ name: path.slice(path.lastIndexOf('/') + 1), kind: f === 'dir' ? 'dir' : 'file', size: f === 'dir' ? 0 : f, isLink: false })),
    run: async (argv, options) => {
      runs.push({ argv, ...(options.env ? { env: options.env } : {}) })
      const answer = git[argv.slice(1).join(' ')] ?? {}
      return { exitCode: answer.exitCode ?? 0, stdout: answer.stdout ?? '', stderr: answer.stderr ?? '' }
    },
  }
  return { probe, runs }
}

describe('measure', () => {
  test('a delete walks folders and counts files and bytes', async () => {
    const { probe } = fakeProbe({ '/p/build': 'dir', '/p/build/a.js': 1000, '/p/build/sub': 'dir', '/p/build/sub/b.js': 2048, '/p/build/c.log': 10 })
    expect(await measure(risk('rm -rf build'), '/p', probe)).toEqual({
      kind: 'delete',
      targets: ['build'],
      found: 1,
      files: 3,
      bytes: 3058,
      sample: ['build/a.js', 'build/c.log', 'build/sub/b.js'],
      truncated: false,
    })
    expect(await measure(risk('rm -rf build/*.log'), '/p', probe)).toMatchObject({ files: 1, sample: ['build/c.log'] })
  })

  test('git runs in English, whatever the locale, because its output is parsed', async () => {
    const { probe, runs } = fakeProbe({}, { 'clean -n -d --': { stdout: 'Would remove tmp/\nWould remove x.log\n' } })
    expect(await measure(risk('git clean -fd'), '/p', probe)).toEqual({ kind: 'clean', ok: true, paths: ['tmp/', 'x.log'], error: '' })
    expect(runs[0]?.env).toEqual({ LC_ALL: 'C', LANGUAGE: 'C' })
    expect(cleanDryRunArgs(['-fdx', '-e', '*.env', 'build'])).toEqual(['clean', '-n', '-dx', '-e', '*.env', '--', 'build'])
  })

  test('reset --hard to an older commit counts the commits the branch drops', async () => {
    const { probe, runs } = fakeProbe(
      {},
      {
        'status --porcelain': { stdout: '' },
        'log --oneline --no-decorate HEAD~2..HEAD': { stdout: 'b2 second\na1 first\n' },
        'diff --shortstat HEAD~2': { stdout: ' 3 files changed, 9 insertions(+)\n' },
      },
    )
    expect(resetTarget(['--hard', 'HEAD~2'])).toBe('HEAD~2')
    expect(resetTarget(['--hard'])).toBe('HEAD')
    expect(await measure(risk('git reset --hard HEAD~2'), '/p', probe)).toEqual({
      kind: 'discard',
      ok: true,
      files: [],
      commits: ['b2 second', 'a1 first'],
      shortstat: '3 files changed, 9 insertions(+)',
      error: '',
    })
    // Plain reset --hard: no log, and the diff against HEAD as before.
    runs.length = 0
    await measure(risk('git reset --hard'), '/p', probe)
    expect(runs.map(r => r.argv.slice(1).join(' '))).toEqual(['status --porcelain', 'diff --shortstat HEAD'])
  })

  test('a force push without a branch goes wherever this branch pushes; option values are not refs', async () => {
    const { probe } = fakeProbe(
      {},
      {
        'rev-parse --abbrev-ref --symbolic-full-name @{push}': { stdout: 'upstream/feature\n' },
        'rev-parse --verify --quiet upstream/feature': {},
        'log --oneline --no-decorate HEAD..upstream/feature': { stdout: 'c3 theirs\n' },
        'rev-parse --abbrev-ref HEAD': { stdout: 'feature\n' },
        'rev-parse --verify --quiet origin/feature': {},
      },
    )
    expect(await measure(risk('git push -f'), '/p', probe)).toEqual({ kind: 'push', target: 'upstream/feature', source: 'HEAD', known: true, commits: ['c3 theirs'] })
    expect(await measure(risk('git push -f -o ci.skip origin'), '/p', probe)).toMatchObject({ target: 'origin/feature' })
    expect(await measure(risk('git push origin +main:release'), '/p', probe)).toMatchObject({ target: 'origin/release', source: 'main', known: true })
  })

  test('an unknown remote branch is said, not guessed', async () => {
    const { probe } = fakeProbe({}, { 'rev-parse --verify --quiet origin/main': { exitCode: 1 } })
    expect(await measure(risk('git push --force origin main'), '/p', probe)).toEqual({ kind: 'push', target: 'origin/main', source: 'main', known: false, commits: [] })
  })
})
