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
ALLOW_SHELL = False
START = time.time()
_env_lock = threading.Lock()
