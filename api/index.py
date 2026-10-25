"""Vercel serverless entrypoint: exposes the FastAPI app from backend/ at /api/*.

The React build is served by Vercel as static files (see vercel.json).
"""

import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "backend"))
os.environ.setdefault("DATA_DIR", str(ROOT / "backend" / "data"))

from app.main import app  # noqa: E402,F401
