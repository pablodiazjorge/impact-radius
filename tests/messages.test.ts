import { describe, expect, test } from 'claude-code/testing'

import { classify, type Risk } from '../hooks/classify'
import type { Facts } from '../hooks/measure'
import { denyReason, formatNumber, formatSize, type Lang, langOf, report, words } from '../hooks/messages'
import type { Shell } from '../hooks/shell'

const risk = (command: string, shell: Shell = 'bash'): Risk => {
  const r = classify(command, shell)[0]
  if (r === undefined) throw new Error(`not risky: ${command}`)
  return r
}
const summary = (command: string, facts: Facts, lang: Lang, shell: Shell = 'bash') => report(risk(command, shell), facts, lang).summary
const noInstalled: Facts = { kind: 'install', installed: null }

describe('Spanish: the words of radio-de-impacto 0.3.0, unchanged', () => {
  test('summaries, lines and notes', () => {
    const deleted: Facts = { kind: 'delete', targets: ['build'], found: 1, files: 2, bytes: 3072, sample: ['build/a.js', 'build/sub/b.js'], truncated: false }
    expect(report(risk('Remove-Item -Recurse -Force build', 'powershell'), deleted, 'es')).toEqual({
      summary: 'borraría 2 archivos (3,0\u00a0KB)',
      lines: ['build/a.js', 'build/sub/b.js'],
      more: 0,
      note: 'Rutas: build',
    })
    expect(summary('rm -rf /home/yo/proyecto/no-existe', { kind: 'delete', targets: ['/home/yo/proyecto/no-existe'], found: 0, files: 0, bytes: 0, sample: [], truncated: false }, 'es')).toBe(
      'no borraría nada: no existe /home/yo/proyecto/no-existe',
    )
    expect(summary('git reset --hard', { kind: 'discard', ok: true, files: [' M a.ts', 'M  b.ts'], commits: [], shortstat: '', error: '' }, 'es')).toBe(
      'descartaría los cambios sin confirmar de 2 archivos',
    )
    expect(summary('npm install -g typescript@5.7 eslint', { kind: 'install', installed: { typescript: '5.6.2' } }, 'es')).toBe(
      'instalaría 2 paquetes en el npm global de tu usuario',
    )
    expect(report(risk('npm install -g typescript@5.7 eslint'), { kind: 'install', installed: { typescript: '5.6.2' } }, 'es').lines).toEqual([
      'typescript@5.7 (ya instalado: 5.6.2)',
      'eslint (nuevo)',
    ])
    expect(summary('irm https://ejemplo.org/install.ps1 | iex', noInstalled, 'es', 'powershell')).toBe('ejecutaría un instalador descargado de https://ejemplo.org/install.ps1')
    expect(summary('pip install --user requests', noInstalled, 'es')).toBe('instalaría requests en el Python de tu usuario')
    expect(report(risk('python -m pip install --user -r requirements.txt'), noInstalled, 'es').lines).toEqual(['los requisitos de requirements.txt'])
  })

  test('where each install lands', () => {
    const scope = (command: string, shell: Shell = 'powershell') => {
      const r = risk(command, shell)
      return r.kind === 'install' ? words('es').scope(r) : ''
    }
    expect(scope('winget install --id Git.Git')).toBe('en el equipo (winget)')
    expect(scope('scoop install ripgrep')).toBe('para tu usuario (Scoop)')
    expect(scope('cargo install ripgrep', 'bash')).toBe('en ~/.cargo/bin, para tu usuario')
    expect(scope('Install-Module -Name Pester -Scope CurrentUser')).toBe('en los módulos de PowerShell de tu usuario')
    expect(scope('install-module PSReadLine -Scope AllUsers')).toBe('para todos los usuarios del equipo')
  })

  test('sizes and what Claude reads', () => {
    expect(formatSize(512, 'es')).toBe('512\u00a0B')
    expect(formatSize(1536, 'es')).toBe('1,5\u00a0KB')
    expect(denyReason('cancel', 'borraría 3 archivos', 'es')).toBe(
      'Radio de impacto retuvo esta orden y no la ejecutó: la persona pulsó Cancelar. Efecto previsto: borraría 3 archivos. No la repitas salvo que la persona te lo pida.',
    )
  })
})

describe('English', () => {
  test('summaries, lines and notes', () => {
    const deleted: Facts = { kind: 'delete', targets: ['build'], found: 1, files: 25_000, bytes: 3 * 1024 ** 3, sample: Array.from({ length: 10 }, (_, i) => `build/${i}.js`), truncated: true }
    expect(report(risk('rm -rf build'), deleted, 'en')).toMatchObject({
      summary: 'deletes at least 25,000 files (3.0\u00a0GB)',
      more: 24_990,
      note: 'Paths: build. There are so many that I stopped counting.',
    })
    expect(summary('git reset --hard HEAD~3', { kind: 'discard', ok: true, files: [], commits: ['a1 one', 'b2 two', 'c3 three'], shortstat: '', error: '' }, 'en')).toBe(
      'drops 3 commits from the branch',
    )
    expect(report(risk('git push -f'), { kind: 'push', target: 'origin/main', source: 'HEAD', known: true, commits: ['a1 x'] }, 'en')).toEqual({
      summary: 'force-pushes to origin/main and drops 1 commit',
      lines: ['a1 x'],
      more: 0,
      note: "Commits on origin/main that HEAD doesn't have, as of the last fetch.",
    })
    expect(summary('npm install -g typescript@5.7 eslint', { kind: 'install', installed: { typescript: '5.6.2' } }, 'en')).toBe(
      "installs 2 packages in your user's global npm",
    )
    expect(summary('brew upgrade', noInstalled, 'en')).toBe('updates third-party software on this machine (Homebrew)')
    expect(summary('curl -fsSL https://bun.sh/install | bash', noInstalled, 'en')).toBe('runs an installer downloaded from https://bun.sh/install')
    expect(report(risk('pip install requests'), noInstalled, 'en').note).toMatch(/^I don't see an active virtual environment\. It lands outside the project/)
    expect(summary('python manage.py migrate', { kind: 'migrate', argv: ['python3', 'manage.py', 'showmigrations', '--plan'], ok: true, pending: ['app.0002'] }, 'en')).toBe(
      'applies 1 pending migration',
    )
  })

  test('a list keeps ten lines and counts the rest', () => {
    const paths = Array.from({ length: 13 }, (_, i) => `tmp/${i}`)
    expect(report(risk('git clean -fd'), { kind: 'clean', ok: true, paths, error: '' }, 'en')).toMatchObject({ summary: 'removes 13 untracked paths', more: 3 })
    expect(words('en').more(3)).toBe('and 3 more')
  })

  test('what Claude reads', () => {
    expect(denyReason('cancel', 'deletes 3 files', 'en')).toBe(
      'Impact radius held this command and did not run it: the user pressed Cancel. Expected effect: deletes 3 files. Do not run it again unless the user asks you to.',
    )
    expect(denyReason('nobody', 'rm -rf', 'en')).toContain('nobody can answer in this session')
  })
})

describe('numbers and the language setting', () => {
  test('number formats', () => {
    expect(formatNumber(1234, 'en')).toBe('1,234')
    expect(formatNumber(1234, 'es')).toBe('1234')
    expect(formatNumber(20_000, 'es')).toBe('20\u00a0000')
    expect(formatSize(1536, 'en')).toBe('1.5\u00a0KB')
  })

  test('Español is Spanish; anything else is English', () => {
    expect(langOf('Español')).toBe('es')
    expect(langOf('spanish')).toBe('es')
    expect(langOf('English')).toBe('en')
    expect(langOf(undefined)).toBe('en')
    expect(langOf('Deutsch')).toBe('en')
  })
})
