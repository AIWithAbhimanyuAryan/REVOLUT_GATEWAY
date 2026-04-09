from __future__ import annotations
import json
import uuid
from dataclasses import asdict, dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

import aiofiles


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _new_session_id() -> str:
    ts = datetime.now(timezone.utc).strftime("%Y-%m-%d_%H-%M-%S")
    uid = uuid.uuid4().hex[:8]
    return f"sess-{ts}-{uid}"


@dataclass
class SessionEntry:
    session_id: str
    session_key: str
    created_at: str
    last_active_at: str
    title: Optional[str] = None


@dataclass
class TranscriptMessage:
    role: str  # "user" | "assistant" | "system"
    content: str
    ts: str
    session_id: str


class SessionManager:
    def __init__(self, data_dir: str) -> None:
        self._data_dir = Path(data_dir)
        self._sessions_file = self._data_dir / "sessions.json"
        self._transcripts_dir = self._data_dir / "transcripts"
        self._store: dict[str, SessionEntry] = {}

    async def init(self) -> None:
        self._transcripts_dir.mkdir(parents=True, exist_ok=True)
        if self._sessions_file.exists():
            async with aiofiles.open(self._sessions_file, "r") as f:
                raw: dict = json.loads(await f.read())
            self._store = {k: SessionEntry(**v) for k, v in raw.items()}

    async def _save_store(self) -> None:
        async with aiofiles.open(self._sessions_file, "w") as f:
            await f.write(json.dumps({k: asdict(v) for k, v in self._store.items()}, indent=2))

    def get_session(self, key: str) -> Optional[SessionEntry]:
        return self._store.get(key)

    def list_sessions(self) -> list[SessionEntry]:
        return sorted(self._store.values(), key=lambda s: s.last_active_at, reverse=True)

    async def create_session(self, key: str, title: Optional[str] = None) -> SessionEntry:
        now = _now_iso()
        entry = SessionEntry(
            session_id=_new_session_id(),
            session_key=key,
            created_at=now,
            last_active_at=now,
            title=title,
        )
        self._store[key] = entry
        await self._save_store()
        return entry

    async def delete_session(self, key: str) -> bool:
        entry = self._store.pop(key, None)
        if entry is None:
            return False
        transcript = self._transcripts_dir / f"{entry.session_id}.jsonl"
        if transcript.exists():
            transcript.unlink()
        await self._save_store()
        return True

    async def append_message(self, key: str, msg: TranscriptMessage) -> None:
        entry = self._store.get(key)
        if entry is None:
            return
        entry.last_active_at = _now_iso()
        transcript = self._transcripts_dir / f"{entry.session_id}.jsonl"
        async with aiofiles.open(transcript, "a") as f:
            await f.write(json.dumps(asdict(msg)) + "\n")
        await self._save_store()

    async def read_transcript(self, key: str) -> list[TranscriptMessage]:
        entry = self._store.get(key)
        if entry is None:
            return []
        transcript = self._transcripts_dir / f"{entry.session_id}.jsonl"
        if not transcript.exists():
            return []
        async with aiofiles.open(transcript, "r") as f:
            lines = await f.readlines()
        return [TranscriptMessage(**json.loads(line)) for line in lines if line.strip()]

    async def resolve_or_create(self, key: str, title: Optional[str] = None) -> SessionEntry:
        return self._store.get(key) or await self.create_session(key, title)
