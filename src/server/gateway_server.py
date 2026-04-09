from __future__ import annotations
import asyncio
import time
import uuid
from dataclasses import dataclass
from typing import Any, Optional

import uvicorn
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.responses import HTMLResponse, JSONResponse
from pydantic import ValidationError

from ..protocol.frames import (
    ErrorShape,
    EventFrame,
    FeaturesInfo,
    HelloOk,
    RequestFrame,
    ResponseFrame,
    ServerInfo,
)
from ..sessions.session_manager import SessionManager
from ..agent.agent_runtime import AgentRuntime, AgentTurnEvent

PROTOCOL_VERSION = 1
SERVER_VERSION = "0.1.0"

METHODS = [
    "chat.send",
    "sessions.list",
    "sessions.create",
    "sessions.delete",
    "sessions.resolve",
    "sessions.history",
]
EVENTS = ["chat.delta", "chat.message", "chat.idle", "chat.tool", "tick"]


@dataclass
class _Client:
    conn_id: str
    ws: WebSocket
    authenticated: bool = False
    subscribed_session: Optional[str] = None


class GatewayServer:
    def __init__(
        self,
        port: int,
        session_manager: SessionManager,
        agent_runtime: AgentRuntime,
        token: Optional[str] = None,
        heartbeat_interval_ms: int = 30000,
    ) -> None:
        self._port = port
        self._token = token
        self._heartbeat_ms = heartbeat_interval_ms
        self._sessions = session_manager
        self._agent = agent_runtime
        self._clients: dict[str, _Client] = {}
        self._event_seq = 0
        self._heartbeat_task: Optional[asyncio.Task] = None
        self._server: Optional[uvicorn.Server] = None

        self.app = FastAPI()
        self.app.add_api_route("/health", self._health, methods=["GET"])
        self.app.add_api_route("/", self._info, methods=["GET"])
        self.app.add_api_websocket_route("/", self._handle_connection)

    # ── HTTP handlers ─────────────────────────────────────────────────────────

    async def _health(self) -> JSONResponse:
        return JSONResponse({"status": "ok", "ts": time.time()})

    async def _info(self) -> HTMLResponse:
        return HTMLResponse(
            f"<html><body><h1>Revolut Gateway</h1>"
            f"<p>WebSocket: <code>ws://localhost:{self._port}/</code></p>"
            f"<p>Health: <a href='/health'>/health</a></p></body></html>"
        )

    # ── Lifecycle ─────────────────────────────────────────────────────────────

    async def start(self) -> None:
        self._heartbeat_task = asyncio.create_task(self._heartbeat_loop())
        config = uvicorn.Config(
            self.app,
            host="0.0.0.0",
            port=self._port,
            log_level="warning",
            access_log=False,
        )
        self._server = uvicorn.Server(config)
        await self._server.serve()

    async def stop(self) -> None:
        if self._heartbeat_task:
            self._heartbeat_task.cancel()
        for client in list(self._clients.values()):
            try:
                await client.ws.close()
            except Exception:
                pass
        if self._server:
            self._server.should_exit = True

    # ── Heartbeat ─────────────────────────────────────────────────────────────

    async def _heartbeat_loop(self) -> None:
        while True:
            await asyncio.sleep(self._heartbeat_ms / 1000)
            await self._broadcast_event("tick", {"ts": time.time()})

    # ── Connection handling ───────────────────────────────────────────────────

    async def _handle_connection(self, ws: WebSocket) -> None:
        await ws.accept()
        conn_id = uuid.uuid4().hex[:12]
        client = _Client(conn_id=conn_id, ws=ws)

        # First message must be a connect request
        try:
            raw = await asyncio.wait_for(ws.receive_text(), timeout=30)
        except (asyncio.TimeoutError, WebSocketDisconnect):
            await ws.close()
            return

        try:
            frame = RequestFrame.model_validate_json(raw)
        except (ValidationError, Exception):
            await self._send_error(ws, None, "PARSE_ERROR", "Failed to parse frame")
            await ws.close()
            return

        if frame.method != "connect":
            await self._send_error(ws, frame.id, "PROTOCOL_ERROR", "First message must be connect")
            await ws.close()
            return

        if self._token:
            params = frame.params or {}
            auth_token = params.get("auth", {}).get("token", "") if isinstance(params, dict) else ""
            if auth_token != self._token:
                await self._send_error(ws, frame.id, "AUTH_ERROR", "Invalid or missing token")
                await ws.close()
                return

        client.authenticated = True
        self._clients[conn_id] = client

        hello = HelloOk(
            protocol=PROTOCOL_VERSION,
            server=ServerInfo(version=SERVER_VERSION, connId=conn_id),
            features=FeaturesInfo(methods=METHODS, events=EVENTS),
        )
        await self._send_response(ws, frame.id, True, hello.model_dump())

        try:
            async for raw_msg in ws.iter_text():
                await self._handle_message(client, raw_msg)
        except WebSocketDisconnect:
            pass
        finally:
            self._clients.pop(conn_id, None)

    async def _handle_message(self, client: _Client, raw: str) -> None:
        try:
            frame = RequestFrame.model_validate_json(raw)
        except (ValidationError, Exception):
            await self._send_error(client.ws, None, "PARSE_ERROR", "Failed to parse frame")
            return
        try:
            payload = await self._route_method(client, frame)
            await self._send_response(client.ws, frame.id, True, payload)
        except Exception as e:
            await self._send_error(client.ws, frame.id, "METHOD_ERROR", str(e))

    # ── Method routing ────────────────────────────────────────────────────────

    async def _route_method(self, client: _Client, frame: RequestFrame) -> Any:
        params: dict = frame.params if isinstance(frame.params, dict) else {}
        match frame.method:
            case "chat.send":
                return await self._handle_chat_send(client, params)
            case "sessions.list":
                return {"sessions": [s.__dict__ for s in self._sessions.list_sessions()]}
            case "sessions.create":
                entry = await self._sessions.create_session(
                    params.get("key", "default"), params.get("title")
                )
                return entry.__dict__
            case "sessions.delete":
                deleted = await self._sessions.delete_session(params.get("key", ""))
                return {"deleted": deleted}
            case "sessions.resolve":
                entry = await self._sessions.resolve_or_create(
                    params.get("key", "default"), params.get("title")
                )
                return entry.__dict__
            case "sessions.history":
                messages = await self._sessions.read_transcript(params.get("key", ""))
                return {"messages": [m.__dict__ for m in messages]}
            case _:
                raise ValueError(f"Unknown method: {frame.method}")

    async def _handle_chat_send(self, client: _Client, params: dict) -> dict:
        session_key = params.get("key", "default")
        message = params.get("message", "")
        await self._sessions.resolve_or_create(session_key)
        client.subscribed_session = session_key

        async def run_agent() -> None:
            def on_event(event: AgentTurnEvent) -> None:
                asyncio.create_task(self._dispatch_agent_event(session_key, event))

            try:
                await self._agent.run_turn(session_key, message, on_event)
            except Exception as e:
                await self._dispatch_agent_event(
                    session_key, AgentTurnEvent(type="error", error=str(e))
                )

        asyncio.create_task(run_agent())
        return {"status": "queued"}

    async def _dispatch_agent_event(self, session_key: str, event: AgentTurnEvent) -> None:
        match event.type:
            case "delta":
                await self._broadcast_session_event(
                    session_key, "chat.delta", {"delta": event.content, "key": session_key}
                )
            case "message":
                await self._broadcast_session_event(
                    session_key, "chat.message", {"content": event.content, "key": session_key}
                )
            case "idle":
                await self._broadcast_session_event(
                    session_key, "chat.idle", {"key": session_key}
                )
            case "error":
                await self._broadcast_session_event(
                    session_key, "chat.error", {"error": event.error, "key": session_key}
                )

    # ── Send helpers ──────────────────────────────────────────────────────────

    async def _send_response(
        self, ws: WebSocket, req_id: Optional[str], ok: bool, payload: Any = None
    ) -> None:
        frame = ResponseFrame(id=req_id or "", ok=ok, payload=payload)
        await ws.send_text(frame.model_dump_json())

    async def _send_error(
        self, ws: WebSocket, req_id: Optional[str], code: str, message: str
    ) -> None:
        frame = ResponseFrame(
            id=req_id or "",
            ok=False,
            error=ErrorShape(code=code, message=message),
        )
        await ws.send_text(frame.model_dump_json())

    def _next_seq(self) -> int:
        self._event_seq += 1
        return self._event_seq

    async def _broadcast_event(self, event: str, payload: Any) -> None:
        frame = EventFrame(event=event, payload=payload, seq=self._next_seq())
        data = frame.model_dump_json()
        for client in list(self._clients.values()):
            if client.authenticated:
                try:
                    await client.ws.send_text(data)
                except Exception:
                    pass

    async def _broadcast_session_event(
        self, session_key: str, event: str, payload: Any
    ) -> None:
        frame = EventFrame(event=event, payload=payload, seq=self._next_seq())
        data = frame.model_dump_json()
        for client in list(self._clients.values()):
            if client.authenticated and client.subscribed_session == session_key:
                try:
                    await client.ws.send_text(data)
                except Exception:
                    pass
