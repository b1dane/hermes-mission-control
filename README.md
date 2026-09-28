# ☤ Hermes Mission Control (Termux edition)

A local-first mission-control dashboard for [Hermes Agent](https://github.com/NousResearch/hermes-agent)
that runs **entirely on your Android device** inside Termux. A tiny stdlib-only Python bridge drives
the real `hermes` CLI and reads `~/.hermes`; the React/Tailwind UI is compiled into one `dist/index.html`.

```
 Browser (Android)  ──HTTP/SSE──▶  server/hermes_mc.py (python)  ──subprocess──▶  hermes CLI
                                       │                                          ~/.hermes/
                                       └─ /proc, termux-api  (CPU · RAM · battery · thermal · net)
```

## Install in Termux

```bash
pkg install python nodejs-lts git termux-api      # termux-api = battery/notifications (optional)
pkg install hermes-agent                          # Nous signed APT repo, aarch64
hermes setup                                      # provider + model wizard

git clone <this repo> ~/hermes-mission-control && cd ~/hermes-mission-control
bash start.sh                                     # builds once, serves on http://127.0.0.1:8664
```

Add the page to your home screen for a full-screen app. For phone ⇄ laptop access over Tailscale:
`bash start.sh --lan` (prints a token; paste it under **Config → Agent Link**).

## What is live vs. simulated

| Panel | Source |
|---|---|
| Device vitals | `/proc/stat`, `/proc/meminfo`, `/sys/class/thermal`, `/proc/net/dev`, `termux-battery-status` |
| Agent summary | `hermes --version`, `~/.hermes/config.yaml`, gateway pid scan |
| Sessions | `~/.hermes/state.db` (read-only sqlite) → `hermes sessions list` fallback |
| Cron | `~/.hermes/cron/jobs.json` · actions via `hermes cron pause/resume/run/remove/create` |
| Skills | `~/.hermes/skills/**/SKILL.md` frontmatter |
| Memory | `MEMORY.md`, `USER.md`, `SOUL.md` |
| Logs | `~/.hermes/logs/*.log` tail |
| Console | `POST /api/exec` → any non-interactive `hermes …` subcommand |
| Chat | `hermes chat -q "…" --format stream-json` streamed over SSE (falls back to `hermes -z`) |
| MCP connections | Hermes config + `hermes mcp test/install/login/remove`; secure HTTP/stdio setup, filters, resources, prompts, OAuth, and catalog |
| Voice | Browser speech recognition for dictation; Android/device speech synthesis for spoken replies |

If the bridge is unreachable (e.g. you opened `dist/index.html` directly) the UI drops into **DEMO** mode
with simulated telemetry so every screen still works.

The **MCP** area manages the active Hermes profile: review configured servers, test tool discovery,
enable or remove a connection, apply tool allowlists, browse/install the Nous catalog, add HTTP or
stdio servers, store credentials in the private `~/.hermes/.env`, and start OAuth login. Hermes can
also be exposed to other MCP clients through `hermes mcp serve`. Chat supports microphone dictation
and optional spoken replies; recognition is browser-managed and may use the recognizer configured
on Android, while speech output uses the device browser's speech engine.

## Bridge flags

```
python server/hermes_mc.py [--host 127.0.0.1] [--port 8664] [--token SECRET] [--allow-shell] [--open]
```

`--allow-shell` lets the console run arbitrary commands (default: `hermes …` only). Never expose the
bridge on a public interface without `--token`.
