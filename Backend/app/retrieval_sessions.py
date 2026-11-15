"""Persistent retrieval-session state for explicitly selected raster batches."""

from __future__ import annotations

import json
import os
import re
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from uuid import uuid4

SESSION_RE = re.compile(r"^[a-f0-9]{32}$")


def now() -> str:
    return datetime.now(timezone.utc).isoformat()


def session_path(data_root: Path, session_id: str) -> Path:
    if not SESSION_RE.fullmatch(session_id):
        raise ValueError("Invalid retrieval session identifier.")
    root = (data_root / "retrieval_sessions").resolve()
    path = (root / f"{session_id}.json").resolve()
    if path.parent != root:
        raise ValueError("Invalid retrieval session path.")
    return path


def write_session(path: Path, value: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(f".{path.name}.{uuid4().hex}.tmp")
    try:
        with temporary.open("w", encoding="utf-8") as stream:
            stream.write(json.dumps(value, indent=2, allow_nan=False))
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temporary, path)
    finally:
        temporary.unlink(missing_ok=True)


def read_session(data_root: Path, session_id: str) -> dict[str, Any]:
    path = session_path(data_root, session_id)
    try:
        return json.loads(path.read_text())
    except FileNotFoundError as exc:
        raise KeyError("Retrieval session was not found.") from exc


def create_session(data_root: Path, study_id: str, study_area: dict[str, Any],
                   start_date: str | None, end_date: str | None,
                   combinations: list[dict[str, Any]]) -> dict[str, Any]:
    session_id = uuid4().hex
    created = now()
    state = {
        "retrievalSessionId": session_id, "studyId": study_id,
        "studyArea": study_area, "startDate": start_date, "endDate": end_date,
        "status": "queued", "createdAt": created, "updatedAt": created,
        "selectedGranuleCount": len({item["granuleId"] for item in combinations}),
        "completedCount": 0, "failedCount": 0,
        "combinations": [{**item, "status": "queued", "jobId": None, "error": None,
                          "raster": None, "updatedAt": created} for item in combinations],
    }
    write_session(session_path(data_root, session_id), state)
    return state
