#!/usr/bin/env python3
"""Temporary loader: reconstruct mc_bridge from server/_parts then re-exec."""
from pathlib import Path
import os
import sys

here = Path(__file__).resolve().parent
parts_dir = here / "_parts"
chunks = sorted(parts_dir.glob("part*.txt"), key=lambda p: int(p.stem[4:]))
if not chunks:
    sys.stderr.write("server/_parts missing — cannot start bridge\n")
    sys.exit(1)
code = "".join(p.read_text() for p in chunks)
real = here / "mc_bridge_impl.py"
real.write_text(code)
os.execv(sys.executable, [sys.executable, str(real), *sys.argv[1:]])
