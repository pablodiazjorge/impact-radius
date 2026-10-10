<h1 align="center">impact-radius</h1>

<p align="center">
  A Claude Code mod that holds a risky shell command, shows what it would change, and waits for you to press Run or Cancel
</p>

<p align="center">
  <img src="https://img.shields.io/badge/Claude_Code-%E2%89%A5_2.1.293-D97757?logo=claude&logoColor=fff" alt="Claude Code 2.1.293 or newer">
  <img src="https://img.shields.io/badge/version-1.0.0-blue" alt="Version">
  <img src="https://img.shields.io/badge/type-mod-6f42c1" alt="Claude Code mod">
  <img src="https://img.shields.io/badge/license-MIT-green" alt="License">
</p>

<p align="center"><a href="README.es.md">Leer en español</a></p>

<!-- Screenshot: the pane in a light theme (media/pane-light.png) -->
<!-- Screenshot: the pane in a dark theme (media/pane-dark.png) -->

Claude sometimes runs commands that can wreck work or put someone else's software on your whole machine: a recursive delete, `git reset --hard`, a force push, `npm install -g`, `curl … | sh`. impact-radius holds those commands before they run, measures what they would change, and asks you. Claude waits for your answer.

It watches **Bash and PowerShell**, and it measures with the engine's own file and process calls, never `bash`, so it works the same on **Windows, macOS and Linux**.

## What it holds

| Command | What it shows |
|---|---|
| `rm -r`/`-f` (Bash); `Remove-Item -Recurse`/`-Force` and its aliases `rm`, `del`, `rd`, `ri` (PowerShell) | How many files it would delete, how much space they take, and the first ten |
| `git reset --hard`, `git checkout -- .`, `git restore .` | The files with uncommitted changes that would be lost, and the commits a reset to an older commit drops from the branch |
| `git clean` (without `-n`) | What it would remove, according to `git clean -n` |
| `git push --force`, `-f`, `--force-with-lease` or `+branch` | The remote commits that would disappear |
| Migrations: Django, Alembic, Rails, Prisma and any `… migrate` | The pending migrations |
| Third-party installs for the whole user or system (list below) | What would be installed and where; for npm, which packages you already have and their version |

### Third-party installs

What gets installed outside the project is there for every session, and it's someone else's code running with your permissions, also while it installs. So these are held:

- **Global JavaScript packages:** `npm install -g` (also `i`, `add`, `update` and `--location=global`), `pnpm add -g`, `bun add -g`, `yarn global add`, `volta install`, `deno install -g`.
- **Python:** `pip install` (and `python -m pip`, `py -m pip`) outside a virtual environment or with `--user`, `pipx install`, `uv tool install` and `uv pip install --system`.
- **Language tools:** `cargo install`, `go install`, `gem install`, `dotnet tool install -g`, `nvm install`.
- **System package managers:** `winget`, `choco`/`cinst`, `scoop`, `brew`, `apt`/`apt-get`, `dnf`, `yum`, `zypper`, `pacman -S`, `apk`, `snap`, `flatpak` and `port`, when installing or upgrading.
- **PowerShell:** `Install-Module`, `Install-Package`, `Install-Script`, `Install-PSResource` and `Update-Module`, saying whether it's for your user or for everyone (`-Scope AllUsers`).
- **Editors and Claude Code:** `code --install-extension` (also Cursor and VSCodium), `claude plugin install` at user scope (the default) and `claude mcp add --scope user`.
- **Installers from the internet that run without being saved:** `curl … | sh`, `wget -qO- … | bash`, `curl … | python3 -`, `irm … | iex`, `bash -c "$(curl …)"` and `iex ((New-Object Net.WebClient).DownloadString(…))`. It shows where the script comes from.

What stays in the project goes through without a question: `npm install` without `-g`, `yarn add`, `pip install` inside a virtual environment (active in the session, activated in the same command, or using the `pip` of `.venv`), `uv pip install`, `pip install --target`, `claude plugin install --scope project` or `claude mcp add` without `--scope user`. Downloading and reading data isn't held either, like `curl … | jq` or `curl … | python3 -m json.tool`.

It follows `cd`, `Set-Location`, `pushd`/`popd` and `git -C` on the same line, to measure in the right folder. Commands that only read (`git status`, `Get-ChildItem`, `rm` of a single file without options, `Remove-Item -WhatIf`, `git clean -n`…) go through without opening anything. When a line holds several risky commands, the pane measures the first and names the others, because Run approves the whole line.

## How it works

1. When the engine decides whether a Bash or PowerShell call may run (`tool.check`), impact-radius classifies the command (`hooks/classify.ts` and `hooks/installs.ts`, pure logic with their own tests). If your rules already deny it, it asks nothing.
2. If it's risky, it measures it with the engine's file calls and `git`, run in English so its output can be read whatever your locale. A huge delete stops counting at 20,000 files or 8 seconds and says so ("at least…"). For a global npm install it reads `npm ls -g`, which only reads the disk; other installs are described, not measured.
3. It opens the **Impact radius** pane with the expected effect and the buttons. If the screen can't place the pane (a narrow terminal), the notice goes above the prompt, with whatever other mods draw there underneath.
4. It waits inside a short process, because time inside an engine call doesn't count against a hook's budget. On Linux and macOS it uses `sleep`; on Windows, Git for Windows' `sleep.exe` (found with `git --exec-path`) or, without it, PowerShell's `Start-Sleep`.
5. **Run** is the permission: the engine doesn't ask again afterwards. With **Cancel**, after 10 minutes without an answer, if the turn is interrupted or if the mod fails, the command doesn't run, and Claude reads why and the expected effect, with an instruction not to run it again unless you ask.

One held command at a time: another one (a subagent's, say) waits for your answer to the first. A call that arrives while a command is held, from inside that wait, is not held again: a harmless one goes through and a risky one is refused, saying another command is waiting. In a session nobody can answer, such as a plain `claude -p`, a risky command is refused at once instead of waiting 10 minutes.

## The pane

- Cancel comes first and has the focus, so Enter never runs anything by accident. On the terminal the buttons show their keys (`c` Cancel, `r` Run); the desktop app draws its own buttons, with Cancel as the main one.
- Every word is in the theme's text color, the only one that keeps a 7:1 contrast (WCAG AAA) in light and dark themes. Color goes to the border and the icons.

<!-- Screenshot: the notice above the prompt when the pane doesn't fit (media/band.png) -->

## Language

In `/config`, under impact-radius, **Language** is `English` (the default) or `Español`. It sets the pane and what Claude reads when a command is cancelled.

## Permissions

It needs no rules: it hooks into Claude Code's own permission decision. What it runs to measure (`git status`, `git clean -n`, `git log`, `npm ls -g`, the migration listing, and the wait with `sleep` or `Start-Sleep`) is started by the mod and doesn't go through your rules.

How it lives with your rules:

- **`deny` rules** win. A risky command that is already denied is refused without opening the pane.
- **`allow` rules** don't skip it. A risky command is held even if a rule allows it, because the decision has to be yours, with the effect in front of you.
- **`ask` rules:** the pane replaces the engine's question. Pressing Run is the permission, and you are not asked twice.
- **Auto mode:** it holds there too, even though in that mode the engine wouldn't ask you.

Plugins asking about a command (`$.tool.check` with no real call behind it) don't open anything. Listing migrations runs the project's own tool (`python manage.py showmigrations`, `bin/rails db:migrate:status`…), which loads the project's code. Only Bash and PowerShell are watched: a file Claude deletes with another tool doesn't go through here.

## Install

Inside a Claude Code session:

```text
/plugin install impact-radius --marketplace pablodiazjorge/impact-radius
```

Or in a terminal:

```bash
claude plugin marketplace add pablodiazjorge/impact-radius
```

```bash
claude plugin install impact-radius@impact-radius
```

## Development

The classifier, the measuring and the words are plain modules tested directly; the hooks are tested against a simulated engine.

```bash
claude plugin validate .claude-plugin/plugin.json
```

```bash
claude plugin test .
```

CI runs both on Ubuntu, macOS and Windows with Claude Code 2.1.293.

## Acknowledgements

The idea comes from Anthropic's [blast-radius](https://github.com/anthropics/claude-code-playground/tree/main/claude-code/mods/blast-radius). impact-radius is written from scratch; see [ACKNOWLEDGEMENTS.md](ACKNOWLEDGEMENTS.md).

## License

[MIT](LICENSE)
