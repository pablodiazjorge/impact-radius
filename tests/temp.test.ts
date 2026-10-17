import { describe, expect, test } from 'claude-code/testing'

import { expandTemporaryVariables, insideTemporary, temporaryPath, temporaryRoots } from '../hooks/temp'

const WINDOWS_TEMP = 'C:\\Users\\me\\AppData\\Local\\Temp'
const winRoots = temporaryRoots({ TEMP: WINDOWS_TEMP, TMP: WINDOWS_TEMP }, true)

describe('temporary folders', () => {
  test('the roots come from TEMP, TMP and TMPDIR, plus /tmp and /var/tmp off Windows, never a drive or the root', () => {
    expect(winRoots).toEqual(['C:/Users/me/AppData/Local/Temp'])
    expect(temporaryRoots({ TMPDIR: '/var/folders/x/T/' }, false)).toEqual(['/var/folders/x/T', '/tmp', '/var/tmp'])
    expect(temporaryRoots({ TEMP: 'C:\\', TMP: '/', TMPDIR: 'relative/tmp' }, true)).toEqual([])
  })

  test('a path counts only strictly below a root, through a first folder named without wildcards', () => {
    expect(insideTemporary('C:/Users/me/AppData/Local/Temp/claude/x', winRoots, true)).toBe(true)
    // Windows paths compare without case.
    expect(insideTemporary('c:/users/ME/appdata/local/temp/claude', winRoots, true)).toBe(true)
    expect(insideTemporary('C:/Users/me/AppData/Local/Temp', winRoots, true)).toBe(false)
    expect(insideTemporary('C:/Users/me/AppData/Local/Temp/*', winRoots, true)).toBe(false)
    expect(insideTemporary('C:/Users/me/AppData/Local/TempOther/x', winRoots, true)).toBe(false)
    expect(insideTemporary('C:/Users/me/AppData/Local/x', winRoots, true)).toBe(false)
    expect(insideTemporary('/TMP/x', ['/tmp'], false)).toBe(false)
  })

  test('only a leading temporary-folder variable is expanded; any other variable or expression is unknown', () => {
    const vars = { TEMP: WINDOWS_TEMP, TMPDIR: '/tmp' }
    expect(expandTemporaryVariables('$env:TEMP\\claude\\x', vars, 'powershell')).toBe(`${WINDOWS_TEMP}\\claude\\x`)
    expect(expandTemporaryVariables('${env:temp}/x', vars, 'powershell')).toBe(`${WINDOWS_TEMP}/x`)
    expect(expandTemporaryVariables('$TMPDIR/build', vars, 'bash')).toBe('/tmp/build')
    expect(expandTemporaryVariables('${TMPDIR}/build', vars, 'bash')).toBe('/tmp/build')
    expect(expandTemporaryVariables('$TMP/x', vars, 'bash')).toBeNull() // TMP is not set
    expect(expandTemporaryVariables('$T', vars, 'bash')).toBeNull()
    expect(expandTemporaryVariables('$TEMPLATES/x', vars, 'bash')).toBeNull()
    expect(expandTemporaryVariables('$env:TEMP/$name', vars, 'powershell')).toBeNull()
    expect(expandTemporaryVariables('%TEMP%\\x', vars, 'powershell')).toBeNull()
    expect(expandTemporaryVariables('`$x', vars, 'powershell')).toBeNull()
    expect(expandTemporaryVariables('build', vars, 'bash')).toBe('build')
  })

  test('a target resolves against its folder before it is checked', () => {
    const vars = { TEMP: WINDOWS_TEMP }
    expect(temporaryPath('x', 'C:/Users/me/AppData/Local/Temp/claude', 'C:/Users/me', vars, winRoots, 'powershell', true)).toBe('C:/Users/me/AppData/Local/Temp/claude/x')
    // A Git Bash path is the same folder.
    expect(temporaryPath('/c/Users/me/AppData/Local/Temp/claude/x', 'C:/project', 'C:/Users/me', vars, winRoots, 'bash', true)).toBe('C:/Users/me/AppData/Local/Temp/claude/x')
    expect(temporaryPath('..', 'C:/Users/me/AppData/Local/Temp/claude', 'C:/Users/me', vars, winRoots, 'powershell', true)).toBeNull()
    expect(temporaryPath('build', 'C:/project', 'C:/Users/me', vars, winRoots, 'powershell', true)).toBeNull()
    expect(temporaryPath('/tmp/x', '/home/me/project', '/home/me', {}, ['/tmp'], 'bash', false)).toBe('/tmp/x')
  })
})
