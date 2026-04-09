"""
Smoke test for the Revolut Gateway WebSocket server.

Usage:
    uv run python test_ws.py
"""

from __future__ import annotations
import asyncio
import json
import uuid

import websockets


WS_URL = "ws://localhost:18800/"


async def main() -> None:
    print(f"Connecting to {WS_URL}...")
    async with websockets.connect(WS_URL) as ws:
        # 1. Handshake
        req_id = uuid.uuid4().hex[:8]
        await ws.send(json.dumps({
            "type": "req",
            "id": req_id,
            "method": "connect",
            "params": {
                "client": {"id": "test-client", "version": "0.1.0", "platform": "python"},
            },
        }))
        hello = json.loads(await ws.recv())
        print("hello-ok:", json.dumps(hello, indent=2))

        # 2. Send a chat message
        chat_id = uuid.uuid4().hex[:8]
        await ws.send(json.dumps({
            "type": "req",
            "id": chat_id,
            "method": "chat.send",
            "params": {"key": "test-sess", "message": "Hello from Python test!"},
        }))

        # Read until idle
        while True:
            msg = json.loads(await asyncio.wait_for(ws.recv(), timeout=120))
            print(json.dumps(msg))
            if msg.get("type") == "event" and msg.get("event") == "chat.idle":
                break

    print("Done.")


if __name__ == "__main__":
    asyncio.run(main())
