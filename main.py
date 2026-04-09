from __future__ import annotations
import asyncio
import os
import signal

from dotenv import load_dotenv

load_dotenv()

from src.sessions.session_manager import SessionManager
from src.agent.agent_runtime import AgentRuntime
from src.server.gateway_server import GatewayServer


async def _main() -> None:
    port = int(os.getenv("GATEWAY_PORT", "18800"))
    token = os.getenv("GATEWAY_TOKEN", "") or None
    heartbeat_interval_ms = int(os.getenv("HEARTBEAT_INTERVAL_MS", "30000"))
    data_dir = os.getenv("DATA_DIR", ".revolut-data")
    model = os.getenv("OPENAI_MODEL", "gpt-4o-mini")

    session_manager = SessionManager(data_dir)
    await session_manager.init()
    print(f"[SessionManager] Initialized — data dir: {data_dir}")

    agent_runtime = AgentRuntime(session_manager, model=model)
    await agent_runtime.start()
    print(f"[AgentRuntime] Started — model: {model}")

    server = GatewayServer(
        port=port,
        token=token,
        heartbeat_interval_ms=heartbeat_interval_ms,
        session_manager=session_manager,
        agent_runtime=agent_runtime,
    )

    loop = asyncio.get_running_loop()

    def _handle_shutdown() -> None:
        print("\n[Gateway] Shutting down...")
        asyncio.create_task(server.stop())
        asyncio.create_task(agent_runtime.stop())

    loop.add_signal_handler(signal.SIGINT, _handle_shutdown)
    loop.add_signal_handler(signal.SIGTERM, _handle_shutdown)

    print(f"[GatewayServer] Listening on ws://0.0.0.0:{port}/")
    await server.start()


def run() -> None:
    asyncio.run(_main())


if __name__ == "__main__":
    run()
