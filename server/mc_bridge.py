#!/usr/bin/env python3
"""
Hermes Mission Control — built on the Hermes WebUI infrastructure.

Adopts the WebUI's patterns:
  - QuietHTTPServer with daemon threads and overflow protection
  - Proper SIGTERM graceful shutdown
  - Token authentication
  - CORS for local/LAN access

Serves Mission Control's frontend (dist/index.html) and provides the MC API
endpoints that drive the REAL Hermes Agent through its CLI + data files.

Usage:
    python server/mc_bridge.py                    # http://127.0.0.1:8000
    python server/mc_bridge.py --port 8664
    python server/mc_bridge.py --host 0.0.0.0 --token mysecret
"""

from __future__ import annotations

import argparse
import ipaddress
import json
import logging
import os
import re
import shlex
import shutil
import signal
import socket
import sqlite3
import subprocess
import sys
import tempfile
import threading
import time
import traceback
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, parse_qsl, urlencode, urlparse, urlunparse

logger = logging.getLogger(__name__)

# ── discovery ────────────────────────────────────────────────────────────
ROOT = Path(__file__).resolve().parent.parent
DIST = ROOT / "dist"
HOME = Path.home()
PREFIX = os.environ.get("PREFIX", "")
IS_TERMUX = "com.termux" in PREFIX or "TERMUX_VERSION" in os.environ
HERMES_HOME = Path(os.environ.get("HERMES_HOME", HOME / ".hermes")).expanduser()

ANSI = re.compile(r"\x1b\[[0-9;?]*[A-Za-z]|\x1b\][^\x07]*\x07")
TOKEN: str | None = None
START = time.time()
_env_lock = threading.Lock()


def find_hermes() -> str | None:
    for cand in (
        shutil.which("hermes"),
        str(HOME / ".local/bin/hermes"),
        f"{PREFIX}/bin/hermes" if PREFIX else None,
        str(HERMES_HOME / "hermes-agent/venv/bin/hermes"),
    ):
        if cand and os.access(cand, os.X_OK):
            return cand
    return None


HERMES_BIN = find_hermes()


def hermes_env() -> dict:
    env = dict(os.environ)
    env.update({"TERM": "dumb", "NO_COLOR": "1", "PYTHONUNBUFFERED": "1", "HERMES_TUI": "0"})
    return env


def run(args: list[str], timeout: int = 60) -> dict:
    """Run a hermes CLI command and capture clean output."""
    if not HERMES_BIN:
        return {"ok": False, "code": 127, "stdout": "", "stderr": "hermes binary not found", "cmd": args}
    t0 = time.time()
    try:
        p = subprocess.run(
            [HERMES_BIN, *args],
            capture_output=True,
            text=True,
            timeout=timeout,
            env=hermes_env(),
        )
        return {
            "ok": p.returncode == 0,
            "code": p.returncode,
            "stdout": ANSI.sub("", p.stdout),
            "stderr": ANSI.sub("", p.stderr),
            "cmd": ["hermes", *args],
            "duration_ms": int((time.time() - t0) * 1000),
        }
    except subprocess.TimeoutExpired:
        return {"ok": False, "code": 124, "stdout": "", "stderr": f"timed out after {timeout}s", "cmd": args}
    except Exception as e:
        return {"ok": False, "code": 1, "stdout": "", "stderr": str(e), "cmd": args}


# ── TTL cache ────────────────────────────────────────────────────────────
_cache: dict[str, tuple[float, object]] = {}
_cache_lock = threading.Lock()


def cached(key: str, ttl: float, fn):
    now = time.time()
    with _cache_lock:
        hit = _cache.get(key)
        if hit and now - hit[0] < ttl:
            return hit[1]
    val = fn()
    with _cache_lock:
        _cache[key] = (now, val)
    return val


# ── device telemetry ─────────────────────────────────────────────────────
_prev_cpu: tuple[int, int] | None = None
_prev_net: tuple[float, int, int] | None = None


def cpu_percent() -> float:
    global _prev_cpu
    try:
        with open("/proc/stat") as f:
            parts = f.readline().split()
        vals = list(map(int, parts[1:8]))
        idle = vals[3] + vals[4]
        total = sum(vals)
        if _prev_cpu:
            dt = total - _prev_cpu[0]
            di = idle - _prev_cpu[1]
            _prev_cpu = (total, idle)
            return round(100 * (1 - di / dt), 1) if dt > 0 else 0.0
        _prev_cpu = (total, idle)
        return 0.0
    except Exception:
        try:
            return round(os.getloadavg()[0] / (os.cpu_count() or 1) * 100, 1)
        except Exception:
            return 0.0


def mem_info() -> dict:
    try:
        m = {}
        with open("/proc/meminfo") as f:
            for line in f:
                k, v = line.split(":", 1)
                m[k] = int(v.strip().split()[0])
        total = m.get("MemTotal", 0)
        avail = m.get("MemAvailable", m.get("MemFree", 0))
        used = total - avail
        return {"mem": round(100 * used / total, 1) if total else 0, "mem_used_mb": used // 1024, "mem_total_mb": total // 1024}
    except Exception:
        return {"mem": 0, "mem_used_mb": 0, "mem_total_mb": 0}


def net_rate() -> dict:
    global _prev_net
    try:
        rx = tx = 0
        with open("/proc/net/dev") as f:
            for line in f.readlines()[2:]:
                name, data = line.split(":", 1)
                if name.strip() == "lo":
                    continue
                cols = data.split()
                rx += int(cols[0])
                tx += int(cols[8])
        now = time.time()
        out = {"rx_kbps": 0.0, "tx_kbps": 0.0}
        if _prev_net:
            dt = max(now - _prev_net[0], 0.001)
            out = {"rx_kbps": round((rx - _prev_net[1]) / dt / 1024, 1), "tx_kbps": round((tx - _prev_net[2]) / dt / 1024, 1)}
        _prev_net = (now, rx, tx)
        return out
    except Exception:
        return {"rx_kbps": 0.0, "tx_kbps": 0.0}


def thermal() -> float | None:
    best = None
    try:
        for z in Path("/sys/class/thermal").glob("thermal_zone*/temp"):
            try:
                v = int(z.read_text().strip())
                v = v / 1000 if v > 1000 else v
                if 0 < v < 120:
                    best = max(best or 0, v)
            except Exception:
                continue
    except Exception:
        pass
    return round(best, 1) if best is not None else None


def battery() -> dict:
    def probe():
        if shutil.which("termux-battery-status"):
            try:
                out = subprocess.run(["termux-battery-status"], capture_output=True, text=True, timeout=4).stdout
                j = json.loads(out)
                return {"battery": j.get("percentage"), "charging": j.get("status") in ("CHARGING", "FULL"), "batt_temp": j.get("temperature")}
            except Exception:
                pass
        for ps in Path("/sys/class/power_supply").glob("*"):
            cap = ps / "capacity"
            if cap.exists():
                try:
                    st = (ps / "status").read_text().strip() if (ps / "status").exists() else ""
                    return {"battery": int(cap.read_text()), "charging": st in ("Charging", "Full"), "batt_temp": None}
                except Exception:
                    pass
        return {"battery": None, "charging": None, "batt_temp": None}
    return cached("battery", 20, probe)


def disk() -> dict:
    try:
        u = shutil.disk_usage(str(HOME))
        return {"disk_used_gb": round(u.used / 1e9, 1), "disk_total_gb": round(u.total / 1e9, 1), "disk_pct": round(100 * u.used / u.total, 1)}
    except Exception:
        return {"disk_used_gb": 0, "disk_total_gb": 0, "disk_pct": 0}


def sys_uptime() -> float:
    try:
        with open("/proc/uptime") as f:
            return float(f.read().split()[0])
    except Exception:
        return time.time() - START


# ── hermes data readers ──────────────────────────────────────────────────
def hermes_version() -> str | None:
    def probe():
        r = run(["--version"], timeout=20)
        m = re.search(r"(\d+\.\d+[\.\w-]*)", r["stdout"] + r["stderr"])
        return m.group(1) if m else (r["stdout"].strip() or None)
    return cached("version", 600, probe) if HERMES_BIN else None


def read_config() -> dict:
    cfg = HERMES_HOME / "config.yaml"
    if not cfg.exists():
        return {}
    text = cfg.read_text(errors="ignore")
    try:
        import yaml
        data = yaml.safe_load(text) or {}
        model = data.get("model")
        if isinstance(model, dict):
            return {"model": model.get("default"), "provider": model.get("provider"), "base_url": model.get("base_url")}
        return {"model": model, "provider": data.get("provider")}
    except Exception:
        out: dict = {}
        block = re.search(r"^model:\s*\n((?:[ \t]+.*\n?)+)", text, re.M)
        if block:
            for key in ("default", "provider", "base_url"):
                m = re.search(rf"^\s+{key}:\s*[\"']?([^\"'\n#]+)", block.group(1), re.M)
                if m:
                    out["model" if key == "default" else key] = m.group(1).strip()
        else:
            m = re.search(r"^model:\s*[\"']?([^\"'\n#]+)", text, re.M)
            if m:
                out["model"] = m.group(1).strip()
        return out


def gateway_status() -> dict:
    pid = None
    for pf in (HERMES_HOME / "gateway.pid", HERMES_HOME / "gateway_state" / "gateway.pid"):
        if pf.exists():
            try:
                pid = int(pf.read_text().strip().split()[0])
                if not Path(f"/proc/{pid}").exists():
                    pid = None
            except Exception:
                pid = None
    if pid is None:
        try:
            for p in Path("/proc").iterdir():
                if not p.name.isdigit():
                    continue
                try:
                    cmd = (p / "cmdline").read_bytes().replace(b"\0", b" ").decode(errors="ignore")
                except Exception:
                    continue
                if "hermes" in cmd and "gateway" in cmd and "mc_bridge" not in cmd:
                    pid = int(p.name)
                    break
        except Exception:
            pass
    return {"gateway_running": pid is not None, "gateway_pid": pid}


def load_cron() -> list[dict]:
    f = HERMES_HOME / "cron" / "jobs.json"
    if not f.exists():
        return []
    try:
        data = json.loads(f.read_text())
        jobs = data.get("jobs", data) if isinstance(data, dict) else data
        out = []
        for j in jobs:
            if not isinstance(j, dict):
                continue
            out.append({
                "id": j.get("id") or j.get("job_id"),
                "name": j.get("name") or (j.get("prompt") or "")[:40],
                "schedule": j.get("schedule") or j.get("cron") or j.get("schedule_display") or "",
                "prompt": j.get("prompt", ""),
                "enabled": j.get("enabled", j.get("state") != "paused"),
                "state": j.get("state"),
                "deliver": j.get("deliver") or j.get("delivery") or "origin",
                "last_run_at": j.get("last_run_at"),
                "next_run_at": j.get("next_run_at"),
                "last_status": j.get("last_status"),
                "last_error": j.get("last_error"),
                "runs": (j.get("repeat") or {}).get("completed") if isinstance(j.get("repeat"), dict) else j.get("run_count"),
                "skills": j.get("skills") or ([j["skill"]] if j.get("skill") else []),
                "model": j.get("model"),
                "no_agent": j.get("no_agent", False),
            })
        return out
    except Exception as e:
        return [{"id": "err", "name": f"jobs.json unreadable: {e}", "schedule": "", "enabled": False}]


def load_skills() -> list[dict]:
    root = HERMES_HOME / "skills"
    if not root.exists():
        return []
    out = []
    for md in sorted(root.rglob("SKILL.md")):
        try:
            text = md.read_text(errors="ignore")
        except Exception:
            continue
        meta: dict = {}
        fm = re.match(r"^---\s*\n(.*?)\n---", text, re.S)
        if fm:
            for line in fm.group(1).splitlines():
                m = re.match(r"^([\w-]+):\s*(.*)$", line)
                if m:
                    meta[m.group(1)] = m.group(2).strip().strip("\"'")
        rel = md.parent.relative_to(root)
        parts = rel.parts
        out.append({
            "name": meta.get("name") or md.parent.name,
            "description": meta.get("description") or next((l.strip() for l in text.splitlines() if l.strip() and not l.startswith(("#", "---"))), ""),
            "category": parts[0] if len(parts) > 1 else "general",
            "version": meta.get("version"),
            "tags": meta.get("tags"),
            "path": str(md.parent),
            "updated": md.stat().st_mtime,
        })
    return out


def load_memory() -> list[dict]:
    cands = [HERMES_HOME / "memories" / "MEMORY.md", HERMES_HOME / "memories" / "USER.md",
             HERMES_HOME / "MEMORY.md", HERMES_HOME / "USER.md", HERMES_HOME / "SOUL.md"]
    out = []
    for p in cands:
        if p.exists():
            try:
                out.append({"name": p.name, "path": str(p), "content": p.read_text(errors="ignore")[:20000], "updated": p.stat().st_mtime})
            except Exception:
                pass
    return out


def load_sessions(limit: int = 40) -> dict:
    db = HERMES_HOME / "state.db"
    if db.exists():
        try:
            conn = sqlite3.connect(f"file:{db}?mode=ro", uri=True, timeout=3)
            conn.row_factory = sqlite3.Row
            tables = {r[0] for r in conn.execute("select name from sqlite_master where type='table'")}
            if "sessions" in tables:
                cols = [r[1] for r in conn.execute("pragma table_info(sessions)")]

                def pick(*names):
                    return next((n for n in names if n in cols), None)

                c_id = pick("id", "session_id")
                c_title = pick("title", "name")
                c_src = pick("source", "platform")
                c_model = pick("model")
                c_start = pick("started_at", "created_at", "start_time")
                c_end = pick("ended_at", "updated_at", "last_active")
                c_tok = pick("total_tokens", "tokens")
                c_in, c_out = pick("input_tokens", "prompt_tokens"), pick("output_tokens", "completion_tokens")
                c_cost = pick("estimated_cost", "cost", "cost_usd")
                c_msgs = pick("message_count", "messages")
                c_arch = pick("archived")
                order = c_end or c_start or c_id
                q = f"select * from sessions {'where coalesce(' + c_arch + ',0)=0' if c_arch else ''} order by {order} desc limit ?"
                msg_counts: dict = {}
                if not c_msgs and "messages" in tables:
                    mcols = [r[1] for r in conn.execute("pragma table_info(messages)")]
                    if "session_id" in mcols:
                        msg_counts = dict(conn.execute("select session_id, count(*) from messages group by session_id").fetchall())
                sessions = []
                for r in conn.execute(q, (limit,)):
                    d = dict(r)
                    sid = d.get(c_id)
                    tok = d.get(c_tok) if c_tok else None
                    if tok is None and (c_in or c_out):
                        tok = (d.get(c_in) or 0) + (d.get(c_out) or 0)
                    sessions.append({
                        "id": str(sid),
                        "title": d.get(c_title) or "(untitled)",
                        "source": d.get(c_src) or "cli",
                        "model": d.get(c_model),
                        "started": d.get(c_start),
                        "ended": d.get(c_end),
                        "tokens": tok or 0,
                        "cost": d.get(c_cost) or 0,
                        "messages": d.get(c_msgs) if c_msgs else msg_counts.get(sid, 0),
                    })
                total = conn.execute("select count(*) from sessions").fetchone()[0]
                conn.close()
                return {"sessions": sessions, "total": total, "source": "sqlite"}
            conn.close()
        except Exception as e:
            err = str(e)
        else:
            err = "no sessions table"
    else:
        err = "state.db not found"
    r = run(["sessions", "list"], timeout=30)
    return {"sessions": [], "total": 0, "source": "cli", "raw": r["stdout"] or r["stderr"], "note": err}


LOG_RE = re.compile(r"^(?P<ts>\d{4}-\d\d-\d\d[ T]\d\d:\d\d:\d\d)[.,]?\d*\s*[\-]?\s*(?P<level>DEBUG|INFO|WARNING|WARN|ERROR|CRITICAL)?\]?\s*(?P<src>[\w.\-]+)?[:]?\s*(?P<msg>.*)$")


def tail_log(name: str, n: int) -> dict:
    logdir = HERMES_HOME / "logs"
    files = sorted(logdir.glob("*.log"), key=lambda p: p.stat().st_mtime, reverse=True) if logdir.exists() else []
    target = next((f for f in files if f.stem == name), files[0] if files else None)
    if not target:
        return {"file": None, "files": [], "lines": []}
    try:
        with open(target, "rb") as f:
            f.seek(0, 2)
            size = f.tell()
            f.seek(max(0, size - 256 * 1024))
            raw = f.read().decode(errors="ignore").splitlines()[-n:]
    except Exception as e:
        return {"file": target.name, "files": [f.name for f in files], "lines": [], "error": str(e)}
    lines = []
    for ln in raw:
        ln = ANSI.sub("", ln)
        m = LOG_RE.match(ln)
        if m:
            lvl = (m.group("level") or "INFO").lower().replace("warning", "warn").replace("critical", "error")
            lines.append({"ts": m.group("ts")[11:19], "level": lvl, "source": m.group("src") or target.stem, "msg": m.group("msg")})
        else:
            lines.append({"ts": "", "level": "info", "source": target.stem, "msg": ln})
    return {"file": target.name, "files": [f.name for f in files], "lines": lines}


# ── MCP helpers ──────────────────────────────────────────────────────────
def _config_key(name: str, suffix: str = "") -> str:
    escaped = name.replace("\\", "\\\\").replace(".", "\\.")
    return f"mcp_servers.{escaped}" + (f".{suffix}" if suffix else "")


def _read_mcp_config() -> dict:
    result = run(["config", "get", "mcp_servers", "--json"], timeout=25)
    if result["ok"]:
        try:
            value = json.loads(result["stdout"])
            if isinstance(value, dict):
                servers = value.get("mcp_servers", value)
                return servers if isinstance(servers, dict) else {}
        except (json.JSONDecodeError, TypeError):
            pass
    path = HERMES_HOME / "config.yaml"
    try:
        import yaml
        value = yaml.safe_load(path.read_text(errors="ignore")) or {}
        servers = value.get("mcp_servers", {}) if isinstance(value, dict) else {}
        return servers if isinstance(servers, dict) else {}
    except Exception:
        return {}


def _redact_mcp_url(value: str) -> str:
    try:
        parts = urlparse(value)
        host = parts.hostname or ""
        if parts.port:
            host = f"{host}:{parts.port}"
        if parts.username or parts.password:
            host = "***@" + host
        query = []
        for key, item in parse_qsl(parts.query, keep_blank_values=True):
            if re.search(r"token|secret|password|api.?key|auth|credential|client.?secret", key, re.I):
                item = "***"
            query.append((key, item))
        return urlunparse((parts.scheme, host, parts.path, parts.params, urlencode(query), parts.fragment))
    except Exception:
        return "***"


def _safe_mcp_config(value: dict) -> dict:
    def clean(obj, parent_key=""):
        if isinstance(obj, dict):
            out = {}
            for key, val in obj.items():
                k = str(key)
                if k in ("env", "headers") and isinstance(val, dict):
                    out[k] = {name: entry if isinstance(entry, str) and re.fullmatch(r"(?:[A-Za-z0-9_-]+\s+)?\$\{(?:env:)?[A-Za-z_][A-Za-z0-9_]*\}", entry.strip()) else "***" for name, entry in val.items()}
                elif k == "url" and isinstance(val, str):
                    out[k] = _redact_mcp_url(val)
                elif parent_key == "identity_header" and k == "value" and obj.get("value_from") == "static":
                    out[k] = val if isinstance(val, str) and re.fullmatch(r"\$\{(?:env:)?[A-Za-z_][A-Za-z0-9_]*\}", val.strip()) else "***"
                elif re.search(r"token|secret|password|api.?key|credential", k, re.I):
                    out[k] = "***" if val not in (None, "") else val
                else:
                    out[k] = clean(val, k)
            return out
        if isinstance(obj, list):
            return [clean(v, parent_key) for v in obj]
        return obj
    return clean(value)


def _mcp_servers() -> list[dict]:
    servers = _read_mcp_config()
    result = []
    for name, raw in servers.items():
        if not isinstance(raw, dict):
            continue
        cfg = _safe_mcp_config(raw)
        tools_cfg = raw.get("tools") if isinstance(raw.get("tools"), dict) else {}
        include = tools_cfg.get("include")
        exclude = tools_cfg.get("exclude")
        result.append({
            "name": str(name),
            "enabled": raw.get("enabled", True) is not False,
            "transport": "http" if raw.get("url") else "stdio",
            "url": _redact_mcp_url(raw["url"]) if isinstance(raw.get("url"), str) else raw.get("url"),
            "command": raw.get("command"),
            "args": raw.get("args", []),
            "auth": raw.get("auth", "none"),
            "trust": raw.get("trust", "full"),
            "lazy": bool(raw.get("lazy", False)),
            "timeout": raw.get("timeout"),
            "connect_timeout": raw.get("connect_timeout"),
            "parallel": bool(raw.get("supports_parallel_tool_calls", False)),
            "tool_filter": {"include": include, "exclude": exclude, "resources": tools_cfg.get("resources", True), "prompts": tools_cfg.get("prompts", True)},
            "env_keys": sorted((raw.get("env") or {}).keys()) if isinstance(raw.get("env"), dict) else [],
            "header_keys": sorted((raw.get("headers") or {}).keys()) if isinstance(raw.get("headers"), dict) else [],
            "config": cfg,
        })
    return sorted(result, key=lambda item: item["name"].lower())


def _mcp_catalog() -> dict:
    result = cached("mcp_catalog", 90, lambda: run(["mcp", "catalog"], timeout=45))
    text = ANSI.sub("", result.get("stdout", ""))
    rows = []
    for line in text.splitlines():
        line = line.strip().strip("│|").strip()
        if not line or set(line.replace("+", "").replace("-", "").replace("=", "")) == set():
            continue
        if line.lower().startswith(("mcp catalog", "name", "catalog", "available mcp")):
            continue
        parts = re.split(r"\s{2,}|\s*\|s*", line)
        if len(parts) < 2:
            continue
        name = parts[0].strip(" *`│")
        if not re.fullmatch(r"[A-Za-z0-9_-]{1,64}", name):
            continue
        status = parts[1].strip(" *`│") if len(parts) > 2 else "available"
        desc = " ".join(parts[2:] if len(parts) > 2 else parts[1:]).strip()
        rows.append({"name": name, "status": status or "available", "description": desc})
    return {"entries": rows, "raw": text, "ok": result.get("ok", False), "error": result.get("stderr", "")}


def _persist_mcp_secrets(entries: dict[str, str]) -> None:
    if not entries:
        return
    for key, value in entries.items():
        if not re.fullmatch(r"[A-Za-z_][A-Za-z0-9_]*", key):
            raise ValueError(f"invalid environment variable name: {key}")
        if key in {"PATH", "HOME", "PREFIX", "HERMES_HOME", "HERMES_MC_TOKEN", "HERMES_MC_PORT"}:
            raise ValueError(f"refusing to overwrite protected variable: {key}")
        if not isinstance(value, str):
            raise ValueError(f"environment value for {key} must be a string")
    env_path = HERMES_HOME / ".env"
    env_path.parent.mkdir(parents=True, exist_ok=True)
    with _env_lock:
        old = env_path.read_text(errors="ignore").splitlines() if env_path.exists() else []
        keys = set(entries)
        kept = [ln for ln in old if not any(re.match(rf"^\s*(?:export\s+)?{re.escape(k)}\s*=", ln) for k in keys)]
        kept.extend(f"{key}={json.dumps(value, ensure_ascii=False)}" for key, value in entries.items())
        fd, tmp_name = tempfile.mkstemp(prefix=".env.", dir=str(env_path.parent), text=True)
        try:
            os.fchmod(fd, 0o600)
            with os.fdopen(fd, "w", encoding="utf-8") as handle:
                handle.write("\n".join(kept).rstrip() + "\n")
                handle.flush()
                os.fsync(handle.fileno())
            os.replace(tmp_name, env_path)
            os.chmod(env_path, 0o600)
        except Exception:
            try:
                os.unlink(tmp_name)
            except OSError:
                pass
            raise


def _save_mcp_config(name: str, config: dict) -> dict:
    if not re.fullmatch(r"[A-Za-z0-9._-]{1,64}", name):
        return {"ok": False, "code": 2, "stdout": "", "stderr": "server name must use letters, numbers, dots, underscores, or hyphens"}
    result = run(["config", "set", _config_key(name), json.dumps(config, ensure_ascii=False)], timeout=30)
    if result.get("ok"):
        _cache.pop("mcp_servers", None)
    return result


def _parse_mcp_test_tools(output: str) -> list[dict]:
    found = []
    in_tools = False
    for line in ANSI.sub("", output).splitlines():
        if re.search(r"tools discovered", line, re.I):
            in_tools = True
            continue
        if not in_tools:
            continue
        m = re.match(r"\s{1,}([A-Za-z0-9_.-]+)\s{2,}(.+?)\s*$", line)
        if m and m.group(1).lower() not in {"transport", "auth"}:
            found.append({"name": m.group(1), "description": m.group(2)})
    return found


def _redact_mcp_output(text: str) -> str:
    text = ANSI.sub("", text or "")
    text = re.sub(r"(?i)((?:authorization|api[-_ ]?key|access[-_ ]?token|refresh[-_ ]?token|client[-_ ]?secret|password|secret)\s*[:=]\s*)(?:bearer\s+)?[^\s,;\"']+", r"\1***", text)
    text = re.sub(r"(?i)([?&](?:access_token|refresh_token|client_secret|api_key|code)=)[^&#\s]+", r"\1***", text)
    text = re.sub(r"(?i)\bBearer\s+[A-Za-z0-9._~+/-]+=*", "Bearer ***", text)
    return text


# ── chat subprocess (SSE) ────────────────────────────────────────────────
_chat_proc: subprocess.Popen | None = None
_chat_lock = threading.Lock()

INTERACTIVE = {"model", "setup", "tools", "skin", "console", "desktop", "gui", "acp", "dashboard", "serve", "gateway", "update", "uninstall", "login"}


def safe_exec(cmdline: str) -> dict:
    try:
        parts = shlex.split(cmdline)
    except ValueError as e:
        return {"ok": False, "code": 2, "stdout": "", "stderr": f"parse error: {e}"}
    if not parts:
        return {"ok": False, "code": 2, "stdout": "", "stderr": "empty command"}
    if parts[0] == "hermes":
        parts = parts[1:]
    if parts and parts[0] in INTERACTIVE and not any(a in ("--help", "-h", "list", "status", "--check", "--status", "--json") for a in parts[1:]):
        return {"ok": False, "code": 3, "stdout": "", "stderr": f"`hermes {parts[0]}` is interactive — run it directly in Termux."}
    if parts and parts[0] == "chat" and not any(a in ("-q", "--query", "--query-file") for a in parts):
        return {"ok": False, "code": 3, "stdout": "", "stderr": "use the Chat tab for conversations, or `hermes chat -q \"…\"`"}
    if parts and parts[0] == "chat" and "-Q" not in parts and "--quiet" not in parts:
        parts = [*parts, "-Q"]
    return run(parts, timeout=120)


# ── HTTP server (WebUI-pattern QuietHTTPServer) ──────────────────────────
class QuietHTTPServer(ThreadingHTTPServer):
    daemon_threads = True
    request_queue_size = 64
    max_request_workers = 64
    max_overflow_reject_workers = 8
    _OVERFLOW_RESPONSE = b"HTTP/1.1 503 Service Unavailable\r\nConnection: close\r\nContent-Length: 0\r\n\r\n"

    def __init__(self, *args, **kwargs):
        server_address = args[0] if args else kwargs.get('server_address', None)
        if server_address and ':' in server_address[0]:
            self.address_family = socket.AF_INET6
        self.ssl_context: object | None = None
        super().__init__(*args, **kwargs)
        self._request_worker_slots = threading.BoundedSemaphore(self.max_request_workers)
        self._overflow_reject_slots = threading.BoundedSemaphore(self.max_overflow_reject_workers)

    def process_request(self, request, client_address):
        if not self._request_worker_slots.acquire(blocking=False):
            self._reject_overflow_request(request)
            return
        try:
            return super().process_request(request, client_address)
        except Exception:
            self._request_worker_slots.release()
            self._close_request_quietly(request)
            raise

    def process_request_thread(self, request, client_address):
        try:
            return super().process_request_thread(request, client_address)
        finally:
            self._request_worker_slots.release()

    def _close_request_quietly(self, request):
        try:
            request.close()
        except Exception:
            pass

    def _reject_overflow_request(self, request):
        if not self._overflow_reject_slots.acquire(blocking=False):
            self._close_request_quietly(request)
            return
        try:
            threading.Thread(target=self._reject_overflow_request_worker, args=(request,), daemon=True).start()
        except Exception:
            self._overflow_reject_slots.release()
            self._close_request_quietly(request)

    def _reject_overflow_request_worker(self, request):
        try:
            try:
                request.sendall(self._OVERFLOW_RESPONSE)
            except Exception:
                pass
        finally:
            self._close_request_quietly(request)
            self._overflow_reject_slots.release()


class Handler(BaseHTTPRequestHandler):
    server_version = "HermesMC/2.0"
    protocol_version = "HTTP/1.1"
    timeout = 30

    def log_message(self, fmt, *args):
        if "/api/status" in (args[0] if args else ""):
            return
        sys.stderr.write(f"  {time.strftime('%H:%M:%S')} {fmt % args}\n")

    def _cors(self):
        origin = self.headers.get("Origin")
        if origin:
            parsed = urlparse(origin)
            target_host = urlparse("http://" + self.headers.get("Host", "")).hostname
            origin_host = parsed.hostname
            trusted = origin_host in {"localhost", "127.0.0.1", "::1"} and target_host in {"localhost", "127.0.0.1", "::1"}
            if origin_host and target_host and not trusted:
                try:
                    origin_ip = ipaddress.ip_address(origin_host)
                    target_ip = ipaddress.ip_address(target_host)
                    trusted = origin_ip.is_private and origin_ip == target_ip
                except ValueError:
                    trusted = False
            if trusted:
                self.send_header("Access-Control-Allow-Origin", origin)
                self.send_header("Vary", "Origin")
        self.send_header("Access-Control-Allow-Headers", "Content-Type, X-Hermes-Token")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")

    def _json(self, obj, status=200):
        body = json.dumps(obj, default=str).encode()
        self.send_response(status)
        self._cors()
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def _body(self) -> dict:
        n = int(self.headers.get("Content-Length") or 0)
        if not n:
            return {}
        try:
            return json.loads(self.rfile.read(n) or b"{}")
        except Exception:
            return {}

    def _authed(self, query: dict) -> bool:
        if not TOKEN:
            return True
        tok = self.headers.get("X-Hermes-Token") or (query.get("token") or [None])[0]
        return tok == TOKEN

    def do_OPTIONS(self):
        self.send_response(204)
        self._cors()
        self.send_header("Content-Length", "0")
        self.end_headers()

    # ── GET ──────────────────────────────────────────────────────────────
    def do_GET(self):
        u = urlparse(self.path)
        q = parse_qs(u.query)
        path = u.path
        if path.startswith("/api/"):
            if not self._authed(q):
                return self._json({"error": "unauthorized"}, 401)
            try:
                return self._api_get(path, q)
            except Exception as e:
                return self._json({"error": str(e)}, 500)
        return self._static(path)

    def _api_get(self, path, q):
        if path == "/api/health":
            return self._json({
                "ok": True,
                "bridge": "mc-bridge-v2",
                "hermes_bin": HERMES_BIN,
                "hermes_found": bool(HERMES_BIN),
                "hermes_home": str(HERMES_HOME),
                "home_exists": HERMES_HOME.exists(),
                "version": hermes_version(),
                "termux": IS_TERMUX,
                "python": sys.version.split()[0],
                "bridge_uptime_s": int(time.time() - START),
                "time": time.time(),
                "auth": bool(TOKEN),
            })
        if path == "/api/status":
            cfg = cached("config", 30, read_config)
            jobs = cached("cron", 10, load_cron)
            skills = cached("skills", 60, load_skills)
            sess = cached("sessions", 15, lambda: load_sessions(40))
            return self._json({
                "cpu": cpu_percent(), **mem_info(), **battery(),
                "temp": thermal(), **disk(), **net_rate(),
                "uptime_s": sys_uptime(),
                "load": list(os.getloadavg()) if hasattr(os, "getloadavg") else [],
                "cores": os.cpu_count(),
                "hermes": {
                    "version": hermes_version(),
                    "model": cfg.get("model"),
                    "provider": cfg.get("provider"),
                    **cached("gateway", 10, gateway_status),
                    "sessions_total": sess.get("total", 0),
                    "cron_total": len(jobs),
                    "cron_enabled": sum(1 for j in jobs if j.get("enabled")),
                    "skills_total": len(skills),
                },
                "time": time.time(),
            })
        if path == "/api/sessions":
            return self._json(cached("sessions", 15, lambda: load_sessions(40)))
        if path == "/api/cron":
            return self._json({"jobs": load_cron(), "path": str(HERMES_HOME / "cron/jobs.json")})
        if path == "/api/skills":
            return self._json({"skills": cached("skills", 60, load_skills)})
        if path == "/api/memory":
            return self._json({"files": load_memory()})
        if path == "/api/logs":
            n = min(int((q.get("n") or ["200"])[0]), 2000)
            name = (q.get("file") or ["agent"])[0]
            return self._json(tail_log(name, n))
        if path == "/api/config":
            return self._json({"config": cached("config", 30, read_config), "path": str(HERMES_HOME / "config.yaml")})
        if path == "/api/mcp":
            return self._json({"servers": cached("mcp_servers", 5, _mcp_servers), "count": 0, "path": str(HERMES_HOME / "config.yaml")})
        if path == "/api/mcp/catalog":
            return self._json(_mcp_catalog())
        return self._json({"error": "not found"}, 404)

    # ── POST ─────────────────────────────────────────────────────────────
    def do_POST(self):
        u = urlparse(self.path)
        q = parse_qs(u.query)
        if not self._authed(q):
            return self._json({"error": "unauthorized"}, 401)
        body = self._body()
        try:
            if u.path == "/api/exec":
                return self._json(safe_exec(str(body.get("cmd", ""))))
            if u.path == "/api/cron/action":
                action, jid = body.get("action"), str(body.get("id", ""))
                if action not in ("pause", "resume", "run", "remove") or not jid:
                    return self._json({"ok": False, "stderr": "bad action"}, 400)
                res = run(["cron", action, jid], timeout=120 if action == "run" else 30)
                _cache.pop("cron", None)
                return self._json(res)
            if u.path == "/api/cron/create":
                sched = str(body.get("schedule", "")).strip()
                prompt = str(body.get("prompt", "")).strip()
                if not sched or not prompt:
                    return self._json({"ok": False, "stderr": "schedule and prompt required"}, 400)
                args = ["cron", "create", sched, prompt]
                if body.get("name"):
                    args += ["--name", str(body["name"])]
                res = run(args, timeout=30)
                _cache.pop("cron", None)
                return self._json(res)
            if u.path == "/api/mcp/action":
                return self._mcp_action(body)
            if u.path == "/api/mcp/save":
                return self._mcp_save(body)
            if u.path == "/api/mcp/filter":
                return self._mcp_filter(body)
            if u.path == "/api/mcp/catalog/install":
                return self._mcp_install(body)
            if u.path == "/api/chat":
                return self._chat(body)
            if u.path == "/api/chat/cancel":
                with _chat_lock:
                    if _chat_proc and _chat_proc.poll() is None:
                        _chat_proc.send_signal(signal.SIGINT)
                        return self._json({"ok": True, "cancelled": True})
                    return self._json({"ok": True, "cancelled": False})
        except Exception as e:
            return self._json({"error": str(e)}, 500)
        return self._json({"error": "not found"}, 404)

    # ── MCP handlers ────────────────────────────────────────────────────
    def _mcp_action(self, body: dict):
        name = str(body.get("name", "")).strip()
        action = str(body.get("action", "")).strip().lower()
        if not re.fullmatch(r"[A-Za-z0-9._-]{1,64}", name):
            return self._json({"error": "invalid MCP server name"}, 400)
        if action == "test":
            res = run(["mcp", "test", name], timeout=180)
            res["tools"] = _parse_mcp_test_tools(res.get("stdout", "")) if res.get("ok") else []
        elif action in ("enable", "disable"):
            res = run(["config", "set", _config_key(name, "enabled"), "true" if action == "enable" else "false"], timeout=30)
            _cache.pop("mcp_servers", None)
        elif action == "remove":
            res = run(["mcp", "remove", name], timeout=40)
            _cache.pop("mcp_servers", None)
        elif action == "login":
            res = run(["mcp", "login", name], timeout=600)
        elif action == "catalog-install":
            res = run(["mcp", "install", name], timeout=900)
            _cache.pop("mcp_servers", None)
        else:
            return self._json({"error": "unsupported MCP action"}, 400)
        res["stdout"] = _redact_mcp_output(res.get("stdout", ""))
        res["stderr"] = _redact_mcp_output(res.get("stderr", ""))
        return self._json(res)

    def _mcp_save(self, body: dict):
        name = str(body.get("name", "")).strip()
        kind = str(body.get("kind", "http")).lower()
        if not re.fullmatch(r"[A-Za-z0-9._-]{1,64}", name):
            return self._json({"error": "name must contain 1-64 letters, numbers, dots, underscores, or hyphens"}, 400)
        if kind not in ("http", "stdio"):
            return self._json({"error": "transport must be http or stdio"}, 400)
        if name in _read_mcp_config() and not body.get("replace"):
            return self._json({"error": f"MCP server {name!r} already exists; confirm replacement before saving"}, 409)
        config: dict = {"enabled": True}
        secrets: dict[str, str] = {}
        safe_name = re.sub(r"[^A-Za-z0-9_]", "_", name.upper()).strip("_") or "SERVER"
        if kind == "http":
            url = str(body.get("url", "")).strip()
            if not re.match(r"^https?://", url, re.I):
                return self._json({"error": "HTTP MCP endpoints must start with http:// or https://"}, 400)
            parsed_url = urlparse(url)
            if parsed_url.username or parsed_url.password:
                return self._json({"error": "do not put credentials in the URL; use secure headers or ${ENV_VAR} references"}, 400)
            for key, value in parse_qsl(parsed_url.query, keep_blank_values=True):
                if re.search(r"token|secret|password|api.?key|auth|credential", key, re.I) and value and not re.fullmatch(r"\$\{(?:env:)?[A-Za-z_][A-Za-z0-9_]*\}", value):
                    return self._json({"error": f"URL parameter {key!r} looks sensitive; use an environment-variable reference or an HTTP header"}, 400)
            config["url"] = url
            auth = str(body.get("auth", "none")).lower()
            if auth == "oauth":
                config["auth"] = "oauth"
            elif auth not in ("none", "header"):
                return self._json({"error": "auth must be none, header, or oauth"}, 400)
            headers = body.get("headers", [])
            if isinstance(headers, list):
                configured_headers = {}
                for item in headers:
                    if not isinstance(item, dict):
                        continue
                    header_name = str(item.get("name", "")).strip()
                    header_value = str(item.get("value", ""))
                    if not header_name or not re.fullmatch(r"[A-Za-z0-9-]{1,100}", header_name):
                        continue
                    if not header_value:
                        continue
                    if re.fullmatch(r"\$\{(?:env:)?[A-Za-z_][A-Za-z0-9_]*\}", header_value.strip()):
                        configured_headers[header_name] = header_value.strip()
                    else:
                        env_name = str(item.get("env_name", "") or f"MCP_{safe_name}_{re.sub(r'[^A-Za-z0-9]', '_', header_name.upper())}")
                        if not re.fullmatch(r"[A-Za-z_][A-Za-z0-9_]*", env_name):
                            return self._json({"error": f"invalid environment name for header {header_name}"}, 400)
                        secrets[env_name] = header_value
                        prefix = str(item.get("prefix", "")).strip()
                        if prefix and not re.fullmatch(r"[A-Za-z][A-Za-z0-9_-]{0,24}", prefix):
                            return self._json({"error": "header prefix must be a simple auth scheme such as Bearer"}, 400)
                        configured_headers[header_name] = f"{prefix} ${{{env_name}}}".strip()
                if configured_headers:
                    config["headers"] = configured_headers
            if auth == "header" and not config.get("headers"):
                return self._json({"error": "add at least one HTTP header for header authentication"}, 400)
        else:
            command = str(body.get("command", "")).strip()
            if not command:
                return self._json({"error": "stdio command is required"}, 400)
            config["command"] = command
            args = body.get("args", [])
            if isinstance(args, str):
                try:
                    args = shlex.split(args)
                except ValueError as exc:
                    return self._json({"error": f"invalid args: {exc}"}, 400)
            if not isinstance(args, list) or not all(isinstance(v, str) for v in args):
                return self._json({"error": "args must be a list of strings"}, 400)
            if args:
                config["args"] = args
            raw_env = body.get("env", [])
            if isinstance(raw_env, dict):
                raw_env = [{"name": k, "value": v} for k, v in raw_env.items()]
            configured_env = {}
            if isinstance(raw_env, list):
                for item in raw_env:
                    if not isinstance(item, dict):
                        continue
                    key, value = str(item.get("name", "")).strip(), str(item.get("value", ""))
                    if not key or not re.fullmatch(r"[A-Za-z_][A-Za-z0-9_]*", key):
                        continue
                    if re.fullmatch(r"\$\{(?:env:)?[A-Za-z_][A-Za-z0-9_]*\}", value.strip()):
                        configured_env[key] = value.strip()
                    elif value:
                        secrets[key] = value
                        configured_env[key] = "${\" + key + \"}"
            if configured_env:
                config["env"] = configured_env
        options = body.get("options", {})
        allowed = {"transport", "trust", "lazy", "timeout", "connect_timeout",
                    "supports_parallel_tool_calls", "skip_preflight", "keepalive_interval",
                    "idle_timeout_seconds", "max_lifetime_seconds", "protocol", "ssl_verify",
                    "client_cert", "client_key", "cwd", "oauth", "sampling", "elicitation", "identity_header", "tools"}
        if isinstance(options, dict):
            for key, value in options.items():
                if key in allowed:
                    config[key] = value
        advanced = body.get("advanced")
        if advanced:
            if isinstance(advanced, str):
                try:
                    advanced = json.loads(advanced)
                except json.JSONDecodeError as exc:
                    return self._json({"error": f"advanced config must be valid JSON: {exc}"}, 400)
            if not isinstance(advanced, dict):
                return self._json({"error": "advanced config must be a JSON object"}, 400)
            for key, value in advanced.items():
                if key in ("env", "headers") and not isinstance(value, dict):
                    return self._json({"error": f"advanced {key} must be an object"}, 400)
                if key in ("env", "headers") and isinstance(value, dict):
                    for item in value.values():
                        if not isinstance(item, str):
                            return self._json({"error": f"advanced {key} values must be strings"}, 400)
                        if item:
                            env_ref = r"\$\{(?:env:)?[A-Za-z_][A-Za-z0-9_]*\}"
                            allowed_ref = rf"\s*(?:(?:Bearer|Basic|Token)\s+)?{env_ref}\s*"
                            if not re.fullmatch(allowed_ref, item, re.I):
                                return self._json({"error": f"advanced {key} values must be env references; use secure credential fields for raw values"}, 400)
                if key == "oauth" and not isinstance(value, dict):
                    return self._json({"error": "advanced oauth must be an object"}, 400)
                if key == "oauth" and isinstance(value, dict):
                    for secret_key in ("client_secret", "password"):
                        secret_value = value.get(secret_key)
                        if secret_value and (not isinstance(secret_value, str) or not re.fullmatch(r"\$\{(?:env:)?[A-Za-z_][A-Za-z0-9_]*\}", secret_value.strip())):
                            return self._json({"error": f"oauth.{secret_key} must reference an environment variable"}, 400)
                if key == "identity_header" and not isinstance(value, dict):
                    return self._json({"error": "advanced identity_header must be an object"}, 400)
                if key == "identity_header" and isinstance(value, dict) and value.get("value_from") == "static":
                    identity_value = value.get("value")
                    if identity_value and (not isinstance(identity_value, str) or not re.fullmatch(r"\$\{(?:env:)?[A-Za-z_][A-Za-z0-9_]*\}", identity_value.strip())):
                        return self._json({"error": "identity_header.value must reference an environment variable"}, 400)
                if key not in {"command", "args", "url", "enabled", "auth", "env", "headers"} and key in allowed:
                    config[key] = value
                elif key in ("env", "headers"):
                    config[key] = value
        try:
            _persist_mcp_secrets(secrets)
        except Exception as exc:
            return self._json({"error": f"could not save secret to {HERMES_HOME}/.env: {exc}"}, 500)
        result = _save_mcp_config(name, config)
        result["server"] = name
        result["secret_keys"] = sorted(secrets)
        result["stdout"] = _redact_mcp_output(result.get("stdout", ""))
        result["stderr"] = _redact_mcp_output(result.get("stderr", ""))
        return self._json(result, 200 if result.get("ok") else 400)

    def _mcp_filter(self, body: dict):
        name = str(body.get("name", "")).strip()
        if not re.fullmatch(r"[A-Za-z0-9._-]{1,64}", name):
            return self._json({"error": "invalid MCP server name"}, 400)
        if name not in _read_mcp_config():
            return self._json({"error": f"MCP server {name!r} is not configured"}, 404)
        tools = body.get("tools", {})
        if not isinstance(tools, dict):
            return self._json({"error": "tools must be an object"}, 400)
        include = tools.get("include")
        exclude = tools.get("exclude")
        if include is not None and (not isinstance(include, list) or not all(isinstance(v, str) for v in include)):
            return self._json({"error": "include must be a list of tool names"}, 400)
        if exclude is not None and (not isinstance(exclude, list) or not all(isinstance(v, str) for v in exclude)):
            return self._json({"error": "exclude must be a list of tool names"}, 400)
        if include is not None and exclude is not None:
            return self._json({"error": "choose include or exclude, not both"}, 400)
        clean = {}
        if include is not None:
            clean["include"] = include
        elif exclude is not None:
            clean["exclude"] = exclude
        if "resources" in tools:
            clean["resources"] = bool(tools["resources"])
        if "prompts" in tools:
            clean["prompts"] = bool(tools["prompts"])
        if clean:
            result = run(["config", "set", _config_key(name, "tools"), json.dumps(clean)], timeout=30)
        else:
            result = run(["config", "unset", _config_key(name, "tools")], timeout=30)
        _cache.pop("mcp_servers", None)
        result["stdout"] = _redact_mcp_output(result.get("stdout", ""))
        result["stderr"] = _redact_mcp_output(result.get("stderr", ""))
        return self._json(result, 200 if result.get("ok") else 400)

    def _mcp_install(self, body: dict):
        name = str(body.get("name", "")).strip()
        if not re.fullmatch(r"[A-Za-z0-9_-]{1,64}", name):
            return self._json({"error": "invalid catalog entry name"}, 400)
        secrets = body.get("secrets", {})
        if not isinstance(secrets, dict):
            return self._json({"error": "secrets must be an environment-variable map"}, 400)
        try:
            _persist_mcp_secrets({str(k): str(v) for k, v in secrets.items()})
        except Exception as exc:
            return self._json({"error": f"could not save catalog credentials: {exc}"}, 500)
        result = run(["mcp", "install", name], timeout=900)
        _cache.pop("mcp_servers", None)
        result["stdout"] = _redact_mcp_output(result.get("stdout", ""))
        result["stderr"] = _redact_mcp_output(result.get("stderr", ""))
        return self._json(result, 200 if result.get("ok") else 400)

    # ── SSE Chat ─────────────────────────────────────────────────────────
    def _sse(self, obj):
        self.wfile.write(f"data: {json.dumps(obj, default=str)}\n\n".encode())
        self.wfile.flush()

    def _chat(self, body):
        global _chat_proc
        prompt = str(body.get("prompt", "")).strip()
        if not prompt:
            return self._json({"error": "prompt required"}, 400)
        if not HERMES_BIN:
            return self._json({"error": "hermes not found"}, 503)
        with _chat_lock:
            if _chat_proc and _chat_proc.poll() is None:
                return self._json({"error": "a chat turn is already running"}, 409)
        args = [HERMES_BIN, "chat", "-q", prompt, "--format", "stream-json"]
        if body.get("session_id"):
            args += ["--resume", str(body["session_id"])]
        if body.get("model"):
            args += ["-m", str(body["model"])]
        if body.get("yolo"):
            args.append("--yolo")
        self.send_response(200)
        self._cors()
        self.send_header("Content-Type", "text/event-stream; charset=utf-8")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Connection", "close")
        self.end_headers()
        self._sse({"type": "bridge", "msg": "spawning hermes chat", "cmd": " ".join(shlex.quote(a) for a in args[1:])})
        proc = subprocess.Popen(args, stdout=subprocess.PIPE, stderr=subprocess.PIPE, stdin=subprocess.DEVNULL, text=True, bufsize=1, env=hermes_env())
        with _chat_lock:
            _chat_proc = proc
        got_json = False
        try:
            assert proc.stdout
            for line in proc.stdout:
                line = ANSI.sub("", line.rstrip("\n"))
                if not line.strip():
                    continue
                try:
                    ev = json.loads(line)
                    got_json = True
                    self._sse(ev)
                except json.JSONDecodeError:
                    self._sse({"type": "text", "text": line + "\n"})
            proc.wait(timeout=5)
            err = ANSI.sub("", proc.stderr.read() if proc.stderr else "")
            if not got_json and proc.returncode != 0 and "unrecognized" in err:
                self._sse({"type": "bridge", "msg": "stream-json unsupported → falling back to hermes -z"})
                r = run(["-z", prompt], timeout=600)
                self._sse({"type": "text", "text": r["stdout"]})
                self._sse({"type": "result", "exit_code": r["code"], "error": r["stderr"] if r["code"] else None})
            else:
                sid = re.search(r"session_id:\s*(\S+)", err)
                self._sse({"type": "done", "exit_code": proc.returncode, "session_id": sid.group(1) if sid else None, "stderr": err[-1500:]})
        except (BrokenPipeError, ConnectionResetError):
            proc.kill()
        except Exception as e:
            try:
                self._sse({"type": "error", "error": str(e)})
            except Exception:
                pass
        finally:
            if proc.poll() is None:
                proc.kill()
            with _chat_lock:
                _chat_proc = None
        return None

    # ── static file serving ─────────────────────────────────────────────
    def _static(self, path):
        if not DIST.exists():
            body = b"<h1>dist/ not built</h1><p>Run <code>npm run build</code> first.</p>"
            self.send_response(200)
            self.send_header("Content-Type", "text/html")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            return self.wfile.write(body)
        rel = path.lstrip("/") or "index.html"
        f = (DIST / rel).resolve()
        if not str(f).startswith(str(DIST.resolve())) or not f.is_file():
            f = DIST / "index.html"
        mime = {"html": "text/html", "js": "application/javascript", "css": "text/css",
                "svg": "image/svg+xml", "png": "image/png", "json": "application/json",
                "ico": "image/x-icon"}.get(f.suffix.lstrip("."), "application/octet-stream")
        data = f.read_bytes()
        self.send_response(200)
        self.send_header("Content-Type", f"{mime}; charset=utf-8" if mime.startswith("text") or "javascript" in mime else mime)
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "no-cache")
        self.end_headers()
        self.wfile.write(data)


# ── Main ─────────────────────────────────────────────────────────────────
def _ignore_sigpipe():
    if (sigpipe := getattr(signal, "SIGPIPE", None)) is not None:
        signal.signal(sigpipe, signal.SIG_IGN)


def _abort_if_already_serving(host: str, port: int):
    probe_host = '127.0.0.1' if host in ('0.0.0.0', '', '::') else host
    try:
        with socket.create_connection((probe_host, port), timeout=2) as s:
            s.sendall(b'GET /health HTTP/1.0\r\nHost: localhost\r\n\r\n')
            s.settimeout(2)
            data = s.recv(512)
            if data:
                print(f'[!!] FATAL: Another server is already responding on {probe_host}:{port}. Stop the existing instance first.', flush=True)
                sys.exit(1)
    except (ConnectionRefusedError, ConnectionResetError, OSError, socket.timeout):
        pass


def main():
    global TOKEN
    ap = argparse.ArgumentParser(description="Hermes Mission Control bridge (WebUI edition)")
    ap.add_argument("--host", default="127.0.0.1")
    ap.add_argument("--port", type=int, default=int(os.environ.get("HERMES_MC_PORT", 8000)))
    ap.add_argument("--token", default=os.environ.get("HERMES_MC_TOKEN"), help="require X-Hermes-Token header")
    ap.add_argument("--open", action="store_true", help="open in Android browser (termux-open-url)")
    a = ap.parse_args()
    TOKEN = a.token

    if a.host != "127.0.0.1" and not TOKEN:
        print("!! binding to a non-loopback address without --token — anyone on the network can drive your agent.", file=sys.stderr)

    _ignore_sigpipe()
    _abort_if_already_serving(a.host, a.port)

    # Warm up telemetry
    cpu_percent()
    net_rate()

    url = f"http://{a.host}:{a.port}"
    print("☤  Hermes Mission Control (WebUI edition)")
    print(f"   dashboard   {url}")
    print(f"   hermes bin  {HERMES_BIN or 'NOT FOUND (install hermes-agent)'}")
    print(f"   hermes home {HERMES_HOME} {'✓' if HERMES_HOME.exists() else '(missing)'}")
    print(f"   dist        {'✓ built' if (DIST / 'index.html').exists() else '✗ run npm run build'}")
    print(f"   platform    {'Termux/Android' if IS_TERMUX else sys.platform} · python {sys.version.split()[0]}")

    httpd = QuietHTTPServer((a.host, a.port), Handler)

    # SIGTERM → graceful shutdown (WebUI pattern)
    _shutdown_requested = threading.Event()

    def _request_shutdown(signum, _frame):
        if _shutdown_requested.is_set():
            return
        _shutdown_requested.set()
        threading.Thread(target=httpd.shutdown, name="mc-sigterm-shutdown", daemon=True).start()

    try:
        signal.signal(signal.SIGTERM, _request_shutdown)
    except (ValueError, OSError):
        pass

    if a.open and shutil.which("termux-open-url"):
        subprocess.Popen(["termux-open-url", url])

    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\nbye")
    finally:
        httpd.server_close()


if __name__ == "__main__":
    main()