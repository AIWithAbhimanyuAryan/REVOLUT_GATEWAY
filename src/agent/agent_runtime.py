from __future__ import annotations
import asyncio
import os
from collections.abc import Callable
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Optional

from openai import AsyncOpenAI

from ..sessions.session_manager import SessionManager, TranscriptMessage
from ..queue.command_queue import enqueue_in_lane

TURN_TIMEOUT = 120  # seconds

_COPILOT_BASE_URL = "https://api.githubcopilot.com"
_COPILOT_HEADERS = {
    "editor-version": "vscode/1.95.0",
    "editor-plugin-version": "copilot-chat/0.22.0",
    "Copilot-Integration-Id": "vscode-chat",
}


@dataclass
class AgentTurnEvent:
    type: str  # "delta" | "message" | "tool_start" | "tool_complete" | "idle" | "error"
    content: Optional[str] = None
    tool_name: Optional[str] = None
    error: Optional[str] = None


AgentTurnCallback = Callable[[AgentTurnEvent], None]


class AgentRuntime:
    def __init__(self, session_manager: SessionManager, model: str = "gpt-4o-mini") -> None:
        self._sessions = session_manager
        self._model = model
        self._client: Optional[AsyncOpenAI] = None

    async def start(self) -> None:
        github_token = os.getenv("GITHUB_TOKEN")
        if not github_token:
            raise RuntimeError("GITHUB_TOKEN env var is required for GitHub Copilot")
        self._client = AsyncOpenAI(
            api_key=github_token,
            base_url=_COPILOT_BASE_URL,
            default_headers=_COPILOT_HEADERS,
        )
        print(f"[agent] GitHub Copilot client ready — model: {self._model}")

    async def stop(self) -> None:
        self._client = None

    async def run_turn(
        self,
        session_key: str,
        user_message: str,
        on_event: AgentTurnCallback,
    ) -> None:
        async def _run() -> None:
            session = await self._sessions.resolve_or_create(session_key)
            await self._sessions.append_message(
                session_key,
                TranscriptMessage(
                    role="user",
                    content=user_message,
                    ts=datetime.now(timezone.utc).isoformat(),
                    session_id=session.session_id,
                ),
            )

            history = await self._sessions.read_transcript(session_key)
            messages = [{"role": m.role, "content": m.content} for m in history]

            assert self._client is not None
            try:
                full_response = ""
                stream = await self._client.chat.completions.create(
                    model=self._model,
                    messages=messages,
                    stream=True,
                )
                async for chunk in stream:
                    delta = chunk.choices[0].delta.content if chunk.choices else None
                    if delta:
                        full_response += delta
                        on_event(AgentTurnEvent(type="delta", content=delta))

                on_event(AgentTurnEvent(type="message", content=full_response))

                current_session = self._sessions.get_session(session_key)
                if current_session:
                    await self._sessions.append_message(
                        session_key,
                        TranscriptMessage(
                            role="assistant",
                            content=full_response,
                            ts=datetime.now(timezone.utc).isoformat(),
                            session_id=current_session.session_id,
                        ),
                    )
            except Exception as e:
                on_event(AgentTurnEvent(type="message", content=f"Agent error: {e}"))
                on_event(AgentTurnEvent(type="error", error=str(e)))

            on_event(AgentTurnEvent(type="idle"))

        await asyncio.wait_for(
            enqueue_in_lane(f"session:{session_key}", _run),
            timeout=TURN_TIMEOUT,
        )
