import { describe, expect, test } from 'claude-code/testing'

import { classify } from '../hooks/classify'
import { npmPackageName } from '../hooks/installs'
import type { Shell } from '../hooks/shell'

/** The first risk of a command line, or null. */
const first = (command: string, shell: Shell) => classify(command, shell)[0] ?? null

describe('third-party installs for the whole user or system', () => {
  test('global JavaScript packages; project dependencies pass', () => {
    expect(first('npm install -g typescript eslint', 'bash')).toEqual({
      kind: 'install',
      command: 'npm install -g',
      dir: null,
      manager: 'npm',
      action: 'install',
      packages: [{ name: 'typescript' }, { name: 'eslint' }],
      scope: 'js-global',
    })
    expect(first('npm -g i --registry https://r.example @scope/cli@2', 'powershell')).toMatchObject({ packages: [{ name: '@scope/cli@2' }] })
    expect(first('npm install --location=global pnpm', 'bash')).toMatchObject({ manager: 'npm' })
    expect(first('npm update -g', 'bash')).toMatchObject({ action: 'update' })
    expect(first('pnpm add -g turbo', 'bash')).toMatchObject({ command: 'pnpm add -g', packages: [{ name: 'turbo' }] })
    expect(first('yarn global add serve', 'bash')).toMatchObject({ command: 'yarn global add', packages: [{ name: 'serve' }] })
    expect(first('bun add --global vercel', 'bash')).toMatchObject({ manager: 'bun' })
    expect(first('npm install eslint --save-dev', 'bash')).toBeNull()
    expect(first('npm ls -g --depth=0', 'bash')).toBeNull()
    expect(first('npm uninstall -g typescript', 'bash')).toBeNull()
    expect(first('yarn add react', 'bash')).toBeNull()
  })

  test('Python: pip outside a virtual environment, --user, pipx and uv tool', () => {
    expect(first('pip install requests', 'bash')).toMatchObject({ manager: 'pip', packages: [{ name: 'requests' }], scope: 'python-outside-venv', venvDependent: true })
    expect(first('python -m pip install --user -r requirements.txt', 'powershell')).toMatchObject({
      command: 'pip install --user',
      packages: [{ name: 'requirements.txt', from: 'requirements' }],
      scope: 'python-user',
    })
    expect(first('pip install -e . --break-system-packages', 'bash')).not.toHaveProperty('venvDependent')
    expect(first('py -3 -m pip install httpx', 'powershell')).toMatchObject({ manager: 'pip', packages: [{ name: 'httpx' }] })
    expect(first('pipx install ruff', 'bash')).toMatchObject({ manager: 'pipx', packages: [{ name: 'ruff' }], scope: 'python-tool' })
    expect(first('uv tool install black', 'bash')).toMatchObject({ manager: 'uv' })
    expect(first('uv pip install --system numpy', 'bash')).toMatchObject({ command: 'uv pip install --system', scope: 'python-system' })
    // In a virtual environment, or into a folder, it is not for the whole user.
    expect(first('source .venv/bin/activate && pip install requests', 'bash')).toBeNull()
    expect(first('.\\.venv\\Scripts\\Activate.ps1; pip install requests', 'powershell')).toBeNull()
    expect(first('.venv/bin/pip install requests', 'bash')).toBeNull()
    expect(first('pip install --target vendor requests', 'bash')).toBeNull()
    expect(first('uv pip install numpy', 'bash')).toBeNull()
    expect(first('pip show requests', 'bash')).toBeNull()
  })

  test('system package managers, language tools and PowerShell modules', () => {
    expect(first('winget install --id Git.Git -e --source winget', 'powershell')).toMatchObject({
      command: 'winget install',
      packages: [{ name: 'Git.Git' }],
      scope: 'machine',
      via: 'winget',
    })
    expect(first('winget upgrade --all', 'powershell')).toMatchObject({ action: 'update' })
    expect(first('choco install nodejs -y', 'powershell')).toMatchObject({ packages: [{ name: 'nodejs' }], via: 'Chocolatey' })
    expect(first('scoop install ripgrep', 'powershell')).toMatchObject({ scope: 'user-manager', via: 'Scoop' })
    expect(first('sudo apt-get install -y jq', 'bash')).toMatchObject({ command: 'apt-get install', packages: [{ name: 'jq' }], scope: 'system', via: 'apt' })
    expect(first('brew install --cask firefox', 'bash')).toMatchObject({ packages: [{ name: 'firefox' }], via: 'Homebrew' })
    expect(first('cargo install ripgrep', 'bash')).toMatchObject({ scope: 'cargo-bin' })
    expect(first('cargo install --path .', 'bash')).toMatchObject({ packages: [{ name: '.', from: 'path' }] })
    expect(first('go install golang.org/x/tools/gopls@latest', 'bash')).toMatchObject({ packages: [{ name: 'golang.org/x/tools/gopls@latest' }] })
    expect(first('gem install rails -v 7.1', 'bash')).toMatchObject({ packages: [{ name: 'rails' }] })
    expect(first('dotnet tool install -g dotnet-ef', 'bash')).toMatchObject({ command: 'dotnet tool install -g' })
    expect(first('Install-Module -Name Pester -Scope CurrentUser -Force', 'powershell')).toMatchObject({
      command: 'Install-Module',
      packages: [{ name: 'Pester' }],
      scope: 'powershell-user',
    })
    expect(first('install-module PSReadLine -Scope AllUsers', 'powershell')).toMatchObject({ scope: 'powershell-all-users' })
    expect(first('apt-get update', 'bash')).toBeNull()
    expect(first('winget list', 'powershell')).toBeNull()
    expect(first('dotnet tool install dotnet-ef', 'bash')).toBeNull()
  })

  test('editor extensions, Claude Code plugins and user MCP servers', () => {
    expect(first('code --install-extension ms-python.python', 'bash')).toMatchObject({ packages: [{ name: 'ms-python.python' }], scope: 'editor', via: 'VS Code' })
    expect(first('cursor --install-extension x.y', 'bash')).toMatchObject({ via: 'Cursor' })
    expect(first('claude plugin install context7@claude-plugins-official', 'bash')).toMatchObject({
      command: 'claude plugin install',
      packages: [{ name: 'context7@claude-plugins-official' }],
      scope: 'claude-plugin',
    })
    expect(first('claude plugin install x@y --scope project', 'bash')).toBeNull()
    expect(first('claude mcp add --scope user github -- npx -y server', 'bash')).toMatchObject({ packages: [{ name: 'github' }], scope: 'claude-mcp-user' })
    expect(first('claude mcp add github -- npx -y server', 'bash')).toBeNull()
    expect(first('claude plugin update learning@claude-mods --scope user', 'bash')).toBeNull()
  })

  test('installers from the internet that run without being saved', () => {
    expect(first('curl -fsSL https://bun.sh/install | bash', 'bash')).toMatchObject({
      manager: 'remote',
      command: 'curl … | bash',
      scope: 'remote',
      source: 'https://bun.sh/install',
    })
    expect(first('irm https://example.org/install.ps1 | iex', 'powershell')).toMatchObject({ command: 'irm … | iex' })
    expect(first('sh -c "$(curl -fsSL https://example.org/i.sh)"', 'bash')).toMatchObject({ source: 'https://example.org/i.sh' })
    expect(first("iex ((New-Object System.Net.WebClient).DownloadString('https://example.org/i.ps1'))", 'powershell')).toMatchObject({
      command: 'DownloadString … | iex',
      source: 'https://example.org/i.ps1',
    })
    expect(first('curl -sSL https://install.python-poetry.org | python3 -', 'bash')).toMatchObject({ command: 'curl … | python3' })
    expect(first('curl -fsSL https://example.org/i.sh | sudo bash -s -- --yes', 'bash')).toMatchObject({ manager: 'remote' })
    expect(first('curl -fsSL https://example.org/i.sh | bash', 'bash')).not.toHaveProperty('venvDependent')
    // Downloading, or downloading and reading the data with another command, runs nothing.
    expect(first('curl -fsSL https://example.org/data.json | jq .', 'bash')).toBeNull()
    expect(first('curl -s https://example.org/api | python3 -m json.tool', 'bash')).toBeNull()
    expect(first('curl -s https://example.org/api | node -e "process.stdin.pipe(process.stdout)"', 'bash')).toBeNull()
    expect(first('curl -o i.sh https://example.org/i.sh; cat i.sh', 'bash')).toBeNull()
    expect(first('echo hello | bash', 'bash')).toBeNull()
  })

  test('an npm package name without its version', () => {
    expect(npmPackageName('typescript@5.7')).toBe('typescript')
    expect(npmPackageName('@scope/cli@2')).toBe('@scope/cli')
    expect(npmPackageName('@scope/cli')).toBe('@scope/cli')
    expect(npmPackageName('eslint')).toBe('eslint')
  })
})

describe('Bash', () => {
  test('recursive or forced deletes, with their paths', () => {
    expect(first('rm -rf build dist', 'bash')).toEqual({ kind: 'delete', command: 'rm -rf', dir: null, targets: ['build', 'dist'] })
    expect(first('sudo -u root rm -r /tmp/x', 'bash')).toMatchObject({ kind: 'delete', targets: ['/tmp/x'] })
    expect(first('rm -f -- -odd', 'bash')).toMatchObject({ targets: ['-odd'] })
    expect(first('find . -name "*.log" | xargs rm -rf', 'bash')).toMatchObject({ kind: 'delete', targets: [] })
    expect(first('rm notes.txt', 'bash')).toBeNull()
  })

  test('git: reset --hard, clean, force push and discarded changes; the rest passes', () => {
    expect(first('git reset --hard HEAD~1', 'bash')).toMatchObject({ kind: 'git', op: 'reset-hard', args: ['--hard', 'HEAD~1'] })
    expect(first('git clean -fd', 'bash')).toMatchObject({ op: 'clean', args: ['-fd'] })
    expect(first('git clean -n', 'bash')).toBeNull()
    expect(first('git push --force-with-lease origin main', 'bash')).toMatchObject({ op: 'push-force' })
    expect(first('git push origin +main', 'bash')).toMatchObject({ op: 'push-force' })
    expect(first('git checkout -- .', 'bash')).toMatchObject({ op: 'discard', command: 'git checkout -- .' })
    expect(first('git restore --staged .', 'bash')).toBeNull()
    expect(first('git status && git log -1', 'bash')).toBeNull()
    expect(first('git commit -m "rm -rf is not a command here; nor git reset --hard"', 'bash')).toBeNull()
  })

  test('migrations, but not a stray "migrate" in a command that only reads', () => {
    expect(first('python manage.py migrate', 'bash')).toMatchObject({ kind: 'migrate', tool: 'django' })
    expect(first('bin/rails db:migrate', 'bash')).toMatchObject({ tool: 'rails' })
    expect(first('bin/rails db:migrate:status', 'bash')).toBeNull()
    expect(first('npx prisma migrate deploy', 'bash')).toMatchObject({ tool: 'prisma' })
    expect(first('grep -r migrate .', 'bash')).toBeNull()
  })

  test('follows cd, also inside a subshell and with git -C', () => {
    expect(first('cd web && rm -rf node_modules', 'bash')).toMatchObject({ dir: 'web' })
    expect(first('(cd web && make) && rm -rf build', 'bash')).toMatchObject({ dir: null })
    expect(first('pushd a && popd && rm -rf b', 'bash')).toMatchObject({ dir: null })
    expect(first('git -C ../other reset --hard', 'bash')).toMatchObject({ dir: '../other' })
  })

  test('every risky segment of a line, in order, each with its folder', () => {
    expect(classify('rm -rf dist && cd api && git push -f', 'bash')).toMatchObject([
      { kind: 'delete', command: 'rm -rf', dir: null },
      { kind: 'git', op: 'push-force', dir: 'api' },
    ])
    expect(classify('git status; ls', 'bash')).toEqual([])
  })
})

describe('PowerShell', () => {
  test('Remove-Item and its aliases with -Recurse or -Force, abbreviated or not', () => {
    expect(first('Remove-Item -Recurse -Force .\\build', 'powershell')).toEqual({
      kind: 'delete',
      command: 'Remove-Item -Recurse -Force',
      dir: null,
      targets: ['.\\build'],
    })
    expect(first('rm -r -fo dist', 'powershell')).toMatchObject({ kind: 'delete', targets: ['dist'] })
    expect(first('remove-item -LiteralPath "C:\\tmp\\a b" -Rec', 'powershell')).toMatchObject({ targets: ['C:\\tmp\\a b'] })
    expect(first('Remove-Item -Path a,b -Recurse', 'powershell')).toMatchObject({ targets: ['a', 'b'] })
    expect(first('Remove-Item -Recurse build -WhatIf', 'powershell')).toBeNull()
    expect(first('Remove-Item notes.txt', 'powershell')).toBeNull()
  })

  test('Set-Location, blocks and PowerShell operators', () => {
    expect(first('Set-Location web; Remove-Item -Recurse node_modules', 'powershell')).toMatchObject({ dir: 'web' })
    expect(first('if (Test-Path build) { Remove-Item -Recurse -Force build }', 'powershell')).toMatchObject({ kind: 'delete', targets: ['build'] })
    expect(first('& git reset --hard', 'powershell')).toMatchObject({ op: 'reset-hard' })
    expect(first('git fetch; if ($?) { git status }', 'powershell')).toBeNull()
  })
})
