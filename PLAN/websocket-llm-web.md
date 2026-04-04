# Billy Gateway — Simplified OpenClaw Gateway in TypeScript

Build a simplified version of the OpenClaw gateway control plane in `BILLY_GATEWAY/`, using `@github/copilot-sdk` as the agent runtime and a web chat UI for interaction.

## Architecture (mirrors the blog post)

The gateway is the **central hub**: it owns sessions, routes events, enforces single-writer-per-session via a queue, and delegates "thinking" to the Copilot SDK agent runtime.

```
Web UI (browser) ←→ WebSocket ←→ Gateway Server ←→ Copilot SDK (agent runtime)
                                       ↕
                              Session Store (JSONL on disk)
                              Lane-aware FIFO Queue
                              Heartbeat Timer
```

## Components to Build

### 1. Protocol Layer (`src/protocol/`)
- **Frame types**: `RequestFrame`, `ResponseFrame`, `EventFrame` — typed with TypeBox (matching OpenClaw's `{ type: "req" | "res" | "event", ... }` pattern)
- **Connect handshake**: first frame must be `connect`; server replies `hello-ok` with capabilities
- **Validation**: AJV-compiled validators for all frame types

### 2. Session Manager (`src/sessions/`)
- **Session store**: JSON file mapping session keys → session metadata (`sessions.json`)
- **Transcripts**: append-only JSONL files per session (`<sessionId>.jsonl`)
- **Session keys**: simple string keys (e.g. `main`, `web:<connId>`)
- **Isolation**: each session has independent context/history

### 3. Command Queue (`src/queue/`)
- **Lane-aware FIFO**: guarantees one active run per session lane
- **Lanes**: `main`, `cron` (for heartbeat), per-session lanes
- **Concurrency**: configurable max concurrent per lane (default 1 for session lanes)
- **Draining**: support graceful shutdown

### 4. Agent Runtime (`src/agent/`)
- **Copilot SDK integration**: `CopilotClient` + `CopilotSession` for LLM inference
- **Turn loop**: load context (session history) → send to Copilot → stream response → persist → reply
- **Streaming**: forward `assistant.message_delta` events to connected WS clients in real-time
- **Tools**: expose a few built-in tools (file read/write via Copilot's defaults)

### 5. Gateway Server (`src/server/`)
- **WebSocket server**: `ws` library on Node HTTP server
- **Connection lifecycle**: connect → authenticate (simple token) → hello-ok → req/res/event loop
- **Method router**: maps `req.method` to handler functions (e.g. `chat.send`, `sessions.list`, `sessions.create`)
- **Event broadcast**: push events (chat messages, agent events, ticks) to subscribed clients
- **Heartbeat**: periodic tick events to connected clients + optional agent heartbeat turns

### 6. Web Chat UI (`ui/`)
- **React + Vite + TailwindCSS** single-page app
- **WebSocket client**: connects to gateway, handles the typed protocol
- **Chat interface**: message list with streaming, session selector sidebar, send input
- **Session management**: create/switch/list sessions from the UI

### 7. Project Scaffolding
- `package.json` with dependencies: `ws`, `@sinclair/typebox`, `ajv`, `@github/copilot-sdk`, `zod`
- `tsconfig.json` targeting ES2022/NodeNext
- Dev scripts: `dev` (gateway), `dev:ui` (Vite), `build`
- `.env` support for optional config (`GATEWAY_PORT`, `GATEWAY_TOKEN`)
- `README.md` explaining the architecture and how to run

## Implementation Order

1. **Scaffold** — project structure, `package.json`, `tsconfig.json`
2. **Protocol** — frame schemas, validators, types
3. **Queue** — lane-aware FIFO command queue
4. **Sessions** — session store + JSONL transcript persistence
5. **Agent runtime** — Copilot SDK integration, turn loop
6. **Gateway server** — WS server, method router, connection lifecycle, heartbeat
7. **Web UI** — React chat app with WebSocket client
8. **Integration** — wire everything together, test end-to-end

## Key Simplifications vs. Real OpenClaw

| OpenClaw | Billy Gateway |
|---|---|
| 200+ gateway files | ~15-20 files |
| TypeBox + full codegen | TypeBox for schemas, no codegen |
| Multi-channel (Telegram, Slack, etc.) | WebSocket only (web UI) |
| Complex auth (tokens, devices, roles, scopes) | Optional simple bearer token |
| Plugin system | No plugins |
| Hooks, webhooks, cron schedules | Simple heartbeat timer only |
| Config hot-reload | Static config via env vars |
| Node/device pairing | Not included |
