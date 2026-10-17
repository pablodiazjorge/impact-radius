// Which delete targets lie inside the system's temporary folder, where Claude keeps its scratch
// files: a recursive delete there is not held. No `$`: register.tsx hands in the environment's
// values, so it is tested directly.

import { hasWildcards, isAbsolute, resolvePath, type Shell } from './shell'

export type TemporaryVariables = { TEMP?: string; TMP?: string; TMPDIR?: string }

/** The temporary folders: TEMP, TMP and TMPDIR as the environment gives them, plus /tmp and /var/tmp off Windows. */
export function temporaryRoots(vars: TemporaryVariables, windows: boolean): string[] {
  const candidates = [vars.TEMP, vars.TMP, vars.TMPDIR, ...(windows ? [] : ['/tmp', '/var/tmp'])]
  const roots = candidates
    .map(value => (value ?? '').trim())
    .filter(value => value !== '' && isAbsolute(value))
    .map(value => resolvePath('/', value))
    // A drive or the filesystem's root is never a temporary folder, whatever a variable says.
    .filter(root => !/^([A-Za-z]:)?\/?$/.test(root))
  return [...new Set(roots)]
}

/**
 * The target with a leading temporary-folder variable replaced (`$TMPDIR/x`, `${TEMP}/x`, `$env:TEMP\x`);
 * null when it still names a variable, an expression or a command, whose value is unknown here.
 */
export function expandTemporaryVariables(target: string, vars: TemporaryVariables, shell: Shell): string | null {
  const pattern = shell === 'bash' ? /^\$(?:\{(TEMP|TMP|TMPDIR)\}|(TEMP|TMP|TMPDIR))(?=$|[\\/])/ : /^\$(?:\{env:(TEMP|TMP|TMPDIR)\}|env:(TEMP|TMP|TMPDIR))(?=$|[\\/])/i
  const match = pattern.exec(target)
  let expanded = target
  if (match) {
    const name = (match[1] ?? match[2] ?? '').toUpperCase() as keyof TemporaryVariables
    const value = vars[name]
    if (!value) return null
    expanded = value + target.slice(match[0].length)
  }
  return /[$%`]/.test(expanded) ? null : expanded
}

/** Whether a resolved path lies strictly below a temporary folder, through a first folder named without wildcards. */
export function insideTemporary(path: string, roots: string[], windows: boolean): boolean {
  const fold = (text: string) => (windows ? text.toLowerCase() : text)
  return roots.some(root => {
    const base = root.replace(/\/+$/, '')
    if (!fold(path).startsWith(`${fold(base)}/`)) return false
    const first = path.slice(base.length + 1).split('/')[0] ?? ''
    return first !== '' && !hasWildcards(first)
  })
}

/** The resolved path of a delete target when it lies inside a temporary folder, or null. */
export function temporaryPath(target: string, cwd: string, home: string, vars: TemporaryVariables, roots: string[], shell: Shell, windows: boolean): string | null {
  const expanded = expandTemporaryVariables(target, vars, shell)
  if (expanded === null) return null
  const path = resolvePath(cwd, expanded, home)
  return insideTemporary(path, roots, windows) ? path : null
}
