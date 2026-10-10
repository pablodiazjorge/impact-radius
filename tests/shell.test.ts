import { describe, expect, test } from 'claude-code/testing'

import { relativeTo, resolvePath, segments, wildcardToRegex } from '../hooks/shell'

describe('shell helpers', () => {
  test('segments honour each shell quotes and escapes', () => {
    expect(segments('echo "a; b" && ls', 'bash').map(s => s.words)).toEqual([['echo', 'a; b'], ['ls']])
    expect(segments('Write-Host `"hello`"; dir', 'powershell').map(s => s.words)).toEqual([['Write-Host', '"hello"'], ['dir']])
    expect(segments('curl x | sh', 'bash').map(s => s.piped)).toEqual([false, true])
  })

  test('resolvePath understands Windows, Git Bash and the home folder', () => {
    expect(resolvePath('C:\\project', 'build')).toBe('C:/project/build')
    expect(resolvePath('C:\\project', '..\\other\\.\\x')).toBe('C:/other/x')
    expect(resolvePath('C:/project', '/d/data')).toBe('D:/data')
    expect(resolvePath('C:/project', 'D:\\')).toBe('D:/')
    expect(resolvePath('C:/project', '~/tmp', 'C:\\Users\\me')).toBe('C:/Users/me/tmp')
    expect(resolvePath('/home/me/web', '../api')).toBe('/home/me/api')
    expect(relativeTo('C:/project', 'C:/Project/build/a.js')).toBe('build/a.js')
  })

  test('wildcards', () => {
    expect(wildcardToRegex('*.log').test('Error.LOG')).toBe(true)
    expect(wildcardToRegex('build?').test('build2')).toBe(true)
    expect(wildcardToRegex('[ab]*').test('casa')).toBe(false)
  })
})
