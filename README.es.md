<h1 align="center">impact-radius</h1>

<p align="center">
  Un mod de Claude Code que retiene las órdenes de consola arriesgadas, enseña qué cambiarían y espera a que pulses Ejecutar o Cancelar
</p>

<p align="center">
  <img src="https://img.shields.io/badge/Claude_Code-%E2%89%A5_2.1.293-D97757?logo=claude&logoColor=fff" alt="Claude Code 2.1.293 o posterior">
  <img src="https://img.shields.io/badge/version-1.0.0-blue" alt="Versión">
  <img src="https://img.shields.io/badge/type-mod-6f42c1" alt="Mod de Claude Code">
  <img src="https://img.shields.io/badge/license-MIT-green" alt="Licencia">
</p>

<p align="center"><a href="README.md">Read in English</a></p>

<!-- Captura: el panel en tema claro, en castellano (media/pane-light.es.png) -->
<!-- Captura: el panel en tema oscuro, en castellano (media/pane-dark.es.png) -->

A veces Claude ejecuta órdenes que pueden destrozar trabajo o meter software de terceros en todo tu equipo: un borrado recursivo, `git reset --hard`, un push forzado, `npm install -g`, `curl … | sh`. impact-radius las retiene antes de que se ejecuten, mide qué cambiarían y te pregunta. Mientras, Claude espera.

Vigila **Bash y PowerShell** y mide con las llamadas de archivos y procesos del propio motor, nunca con `bash`, así que funciona igual en **Windows, macOS y Linux**.

## Qué retiene

| Orden | Qué enseña |
|---|---|
| `rm -r`/`-f` (Bash); `Remove-Item -Recurse`/`-Force` y sus alias `rm`, `del`, `rd`, `ri` (PowerShell) | Cuántos archivos borraría, cuánto ocupan y los diez primeros |
| `git reset --hard`, `git checkout -- .`, `git restore .` | Los archivos con cambios sin confirmar que se perderían, y los commits que saca de la rama un reset a un commit anterior |
| `git clean` (sin `-n`) | Lo que quitaría, según `git clean -n` |
| `git push --force`, `-f`, `--force-with-lease` o `+rama` | Los commits del remoto que desaparecerían |
| Migraciones: Django, Alembic, Rails, Prisma y cualquier `… migrate` | Las migraciones pendientes |
| Instalaciones de terceros para todo el usuario o el sistema (abajo, la lista) | Qué instalaría y dónde; en npm, cuáles ya tienes y con qué versión |

### Instalaciones de terceros

Lo que se instala fuera del proyecto queda disponible en todas tus sesiones y es código ajeno que se ejecuta con tus permisos, también al instalarse. Por eso se retiene:

- **Paquetes globales de JavaScript:** `npm install -g` (también `i`, `add`, `update` y `--location=global`), `pnpm add -g`, `bun add -g`, `yarn global add`, `volta install`, `deno install -g`.
- **Python:** `pip install` (y `python -m pip`, `py -m pip`) fuera de un entorno virtual o con `--user`, `pipx install`, `uv tool install` y `uv pip install --system`.
- **Herramientas de lenguajes:** `cargo install`, `go install`, `gem install`, `dotnet tool install -g`, `nvm install`.
- **Gestores del sistema:** `winget`, `choco`/`cinst`, `scoop`, `brew`, `apt`/`apt-get`, `dnf`, `yum`, `zypper`, `pacman -S`, `apk`, `snap`, `flatpak` y `port`, al instalar o actualizar.
- **PowerShell:** `Install-Module`, `Install-Package`, `Install-Script`, `Install-PSResource` y `Update-Module`, diciendo si es para tu usuario o para todos (`-Scope AllUsers`).
- **Editores y Claude Code:** `code --install-extension` (también Cursor y VSCodium), `claude plugin install` con ámbito de usuario (el de por defecto) y `claude mcp add --scope user`.
- **Instaladores de internet que se ejecutan sin guardarse:** `curl … | sh`, `wget -qO- … | bash`, `curl … | python3 -`, `irm … | iex`, `bash -c "$(curl …)"` e `iex ((New-Object Net.WebClient).DownloadString(…))`. Enseña de dónde viene el script.

Pasa sin preguntar lo que se queda en el proyecto: `npm install` sin `-g`, `yarn add`, `pip install` dentro de un entorno virtual (activado en la sesión, en la misma orden o usando el `pip` de `.venv`), `uv pip install`, `pip install --target`, `claude plugin install --scope project` o `claude mcp add` sin `--scope user`. Tampoco retiene descargar y leer datos, como `curl … | jq` o `curl … | python3 -m json.tool`.

Sigue los `cd`, `Set-Location`, `pushd`/`popd` y `git -C` de la misma línea para medir en la carpeta correcta. Lo que solo lee (`git status`, `Get-ChildItem`, `rm` de un archivo sin opciones, `Remove-Item -WhatIf`, `git clean -n`…) pasa sin abrir nada. Si una línea lleva varias órdenes arriesgadas, el panel mide la primera y nombra las demás, porque Ejecutar aprueba la línea entera.

## Cómo funciona

1. Cuando el motor decide si una orden de Bash o PowerShell puede ejecutarse (`tool.check`), impact-radius la clasifica (`hooks/classify.ts` y `hooks/installs.ts`, lógica pura con sus tests). Si tus reglas ya la prohíben, no pregunta nada.
2. Si es arriesgada, la mide con las llamadas de archivos del motor y con `git`, que ejecuta en inglés para poder leer su salida sea cual sea tu idioma. Un borrado enorme se deja de contar a los 20 000 archivos o a los 8 segundos, y lo dice («al menos…»). Para una instalación global de npm consulta `npm ls -g`, que solo lee el disco; las demás instalaciones se describen, no se miden.
3. Abre el panel **Radio de impacto** con el efecto previsto y los botones. Si la pantalla no puede colocar el panel (una terminal estrecha), el aviso sale sobre el prompt, con lo que dibujen otros mods debajo.
4. Espera dentro de un proceso corto, porque el tiempo dentro de una llamada al motor no gasta el presupuesto del hook. En Linux y macOS usa `sleep`; en Windows, el `sleep.exe` de Git para Windows (lo encuentra con `git --exec-path`) o, si no está, `Start-Sleep` de PowerShell.
5. **Ejecutar** es el permiso: el motor ya no vuelve a preguntar después. Con **Cancelar**, sin respuesta en 10 minutos, si el turno se interrumpe o si el mod falla, la orden no se ejecuta, y Claude lee por qué y el efecto previsto, con la indicación de no repetirla salvo que se lo pidas.

Una orden retenida cada vez: otra (la de un subagente, por ejemplo) espera a que respondas a la primera. Una llamada que llega mientras hay una orden retenida, desde dentro de esa espera, no se vuelve a retener: si es inocua pasa, y si es arriesgada se rechaza diciendo que ya hay otra esperando. En una sesión en la que nadie puede responder, como un `claude -p` sin más, una orden arriesgada se rechaza al momento en vez de esperar 10 minutos.

## El panel

- Cancelar va primero y tiene el foco, así que Intro nunca ejecuta nada por despiste. En la terminal los botones enseñan su tecla (`c` Cancelar, `e` Ejecutar); la app de escritorio dibuja sus propios botones, con Cancelar como principal.
- Todo el texto va en el color de texto del tema, el único que mantiene un contraste de 7:1 (WCAG AAA) en los temas claros y oscuros. El color queda para el marco y los iconos.

## Idioma

En `/config`, dentro de impact-radius, **Language** es `English` (por defecto) o `Español`. Cambia el panel y lo que lee Claude cuando se cancela una orden.

## Permisos

No necesita ninguna regla: se engancha en la propia decisión de permisos de Claude Code. Lo que ejecuta para medir (`git status`, `git clean -n`, `git log`, `npm ls -g`, el listado de migraciones y la espera con `sleep` o `Start-Sleep`) lo lanza el mod y no pasa por tus reglas.

Con tus reglas convive así:

- **Reglas `deny`:** mandan. Si una orden arriesgada ya está prohibida, se rechaza sin abrir el panel.
- **Reglas `allow`:** no lo saltan. Una orden arriesgada se retiene aunque una regla la permita, porque la decisión tiene que ser tuya y con el efecto delante.
- **Reglas `ask`:** el panel sustituye a la pregunta del motor. Pulsar Ejecutar es el permiso y no se pregunta dos veces.
- **Modo automático:** también retiene, aunque en ese modo el motor no te preguntaría.

Las consultas de otros plugins (`$.tool.check` sin una llamada real detrás) no abren nada. Para listar migraciones ejecuta la herramienta del proyecto (`python manage.py showmigrations`, `bin/rails db:migrate:status`…), que carga el código del proyecto. Solo vigila Bash y PowerShell: un archivo que Claude borre con otra herramienta no pasa por aquí.

## Instalar

Dentro de una sesión de Claude Code:

```text
/plugin install impact-radius --marketplace pablodiazjorge/impact-radius
```

O en una terminal:

```bash
claude plugin marketplace add pablodiazjorge/impact-radius
```

```bash
claude plugin install impact-radius@impact-radius
```

Después, en `/config`, pon **Language** en `Español`.

## Desarrollo

El clasificador, la medición y los textos son módulos sin dependencias del motor y se prueban directamente; los hooks se prueban con un motor simulado.

```bash
claude plugin validate .claude-plugin/plugin.json
```

```bash
claude plugin test .
```

El CI ejecuta las dos órdenes en Ubuntu, macOS y Windows con Claude Code 2.1.293.

## Reconocimientos

La idea viene de [blast-radius](https://github.com/anthropics/claude-code-playground/tree/main/claude-code/mods/blast-radius), de Anthropic. impact-radius está escrito desde cero; mira [ACKNOWLEDGEMENTS.md](ACKNOWLEDGEMENTS.md).

## Licencia

[MIT](LICENSE)
