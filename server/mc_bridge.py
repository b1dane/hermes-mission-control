#!/usr/bin/env python3
"""Bootstrap mc_bridge: fetch original from initial commit, apply fixes, re-exec."""
from __future__ import annotations

import os
import sys
import urllib.request
from pathlib import Path

here = Path(__file__).resolve().parent
impl = here / "mc_bridge_impl.py"
ORIG_URL = (
    "https://raw.githubusercontent.com/b1dane/hermes-mission-control/"
    "e94b4af1da74a6863a063c585f01b9c6254cebdf/server/mc_bridge.py"
)


def apply_fixes(text: str) -> str:
    if "ALLOW_SHELL = False" not in text:
        text = text.replace(
            "TOKEN: str | None = None\nSTART = time.time()",
            "TOKEN: str | None = None\nALLOW_SHELL = False\nSTART = time.time()",
            1,
        )

    old_safe = (
        '    if parts[0] == "hermes":\n'
        "        parts = parts[1:]\n"
        "    if parts and parts[0] in INTERACTIVE"
    )
    new_safe = (
        '    if parts[0] == "hermes":\n'
        "        parts = parts[1:]\n"
        "    elif not ALLOW_SHELL:\n"
        '        return {"ok": False, "code": 126, "stdout": "", "stderr": '
        '"only `hermes …` commands are allowed (start bridge with --allow-shell to lift)"}\n'
        "    else:\n"
        "        t0 = time.time()\n"
        "        p = subprocess.run(parts, capture_output=True, text=True, timeout=90, env=hermes_env())\n"
        "        return {\n"
        '            "ok": p.returncode == 0,\n'
        '            "code": p.returncode,\n'
        '            "stdout": ANSI.sub("", p.stdout),\n'
        '            "stderr": ANSI.sub("", p.stderr),\n'
        '            "cmd": parts,\n'
        '            "duration_ms": int((time.time() - t0) * 1000),\n'
        "        }\n"
        "    if parts and parts[0] in INTERACTIVE"
    )
    if "elif not ALLOW_SHELL:" not in text:
        if old_safe not in text:
            raise SystemExit("safe_exec pattern not found in upstream mc_bridge.py")
        text = text.replace(old_safe, new_safe, 1)

    if 'u.path == "/api/tts"' not in text:
        marker = (
            '                    return self._json({"ok": True, "cancelled": False})\n'
            "        except Exception as e:"
        )
        tts = (
            '                    return self._json({"ok": True, "cancelled": False})\n'
            '            if u.path == "/api/tts":\n'
            '                text_in = str(body.get("text", "")).strip()\n'
            "                if not text_in:\n"
            '                    return self._json({"ok": False, "stderr": "text required"}, 400)\n'
            "                try:\n"
            "                    subprocess.Popen(\n"
            '                        ["termux-tts-speak", text_in],\n'
            "                        stdout=subprocess.DEVNULL,\n"
            "                        stderr=subprocess.DEVNULL,\n"
            "                        env=hermes_env(),\n"
            "                    )\n"
            '                    return self._json({"ok": True})\n'
            "                except FileNotFoundError:\n"
            '                    return self._json({"ok": False, "stderr": "termux-tts-speak not installed"}, 501)\n'
            "        except Exception as e:"
        )
        if marker not in text:
            raise SystemExit("chat cancel marker not found")
        text = text.replace(marker, tts, 1)

    old_main = (
        "def main():\n"
        "    global TOKEN\n"
        '    ap = argparse.ArgumentParser(description="Hermes Mission Control bridge (WebUI edition)")\n'
        '    ap.add_argument("--host", default="127.0.0.1")\n'
        '    ap.add_argument("--port", type=int, default=int(os.environ.get("HERMES_MC_PORT", 8000)))\n'
        '    ap.add_argument("--token", default=os.environ.get("HERMES_MC_TOKEN"), help="require X-Hermes-Token header")\n'
        '    ap.add_argument("--open", action="store_true", help="open in Android browser (termux-open-url)")\n'
        "    a = ap.parse_args()\n"
        "    TOKEN = a.token\n"
    )
    new_main = (
        "def main():\n"
        "    global TOKEN, ALLOW_SHELL\n"
        '    ap = argparse.ArgumentParser(description="Hermes Mission Control bridge (WebUI edition)")\n'
        '    ap.add_argument("--host", default="127.0.0.1")\n'
        '    ap.add_argument("--port", type=int, default=int(os.environ.get("HERMES_MC_PORT", 8000)))\n'
        '    ap.add_argument("--token", default=os.environ.get("HERMES_MC_TOKEN"), help="require X-Hermes-Token header")\n'
        '    ap.add_argument("--allow-shell", action="store_true", help="allow non-hermes commands in /api/exec")\n'
        '    ap.add_argument("--open", action="store_true", help="open in Android browser (termux-open-url)")\n'
        "    a = ap.parse_args()\n"
        "    TOKEN, ALLOW_SHELL = a.token, a.allow_shell\n"
    )
    if "a.allow_shell" not in text:
        if old_main not in text:
            raise SystemExit("main() pattern not found")
        text = text.replace(old_main, new_main, 1)
    return text


def ensure_impl() -> Path:
    if impl.exists() and "ALLOW_SHELL" in impl.read_text() and "/api/tts" in impl.read_text() and "a.allow_shell" in impl.read_text():
        return impl
    print("☤  downloading mc_bridge base and applying fixes…", flush=True)
    with urllib.request.urlopen(ORIG_URL, timeout=60) as resp:
        text = resp.read().decode("utf-8")
    text = apply_fixes(text)
    impl.write_text(text)
    print(f"   wrote {impl} ({len(text)} bytes)", flush=True)
    return impl


if __name__ == "__main__":
    target = ensure_impl()
    os.execv(sys.executable, [sys.executable, str(target), *sys.argv[1:]])
