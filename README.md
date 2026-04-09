# Revolut Gateway

A simplified version of the [OpenClaw](https://github.com/openclaw/openclaw) gateway control plane, built in TypeScript.

Based on the architecture described in [OpenClaw Architecture - Part 1](https://theagentstack.substack.com/p/openclaw-architecture-part-1-control).

## Architecture

```
Web UI (browser) <--> WebSocket <--> Gateway Server <--> Copilot SDK (agent runtime)
                                          |
                                Session Store (JSONL on disk)
                                Lane-aware FIFO Queue
                                Heartbeat Timer
```

**Core concepts:**
- **Gateway** — central WebSocket server that owns all session state and routes events
- **Typed protocol** — req/res/event frames with TypeBox schemas + AJV validation
- **Sessions** — isolated conversation contexts with JSONL transcript persistence
- **Command queue** — lane-aware FIFO ensuring one active agent run per session
- **Agent runtime** — delegates to GitHub Copilot SDK for LLM inference + tool use
- **Heartbeat** — periodic tick events to connected clients

## Prerequisites

- Node.js 22+
- GitHub Copilot CLI installed and authenticated (`copilot` in PATH)

## Quick Start

```bash
# Install dependencies
npm install

# Copy env config
cp .env.example .env

# Start the gateway
npm run dev

# In another terminal, start the web UI
cd ui && npm install && npm run dev
```

The gateway runs on `ws://localhost:18800` by default. The web UI runs on `http://localhost:5173`.

## Configuration (`.env`)

| Variable | Default | Description |
|---|---|---|
| `GATEWAY_PORT` | `18800` | WebSocket server port |
| `GATEWAY_TOKEN` | _(empty)_ | Optional bearer token for auth |
| `HEARTBEAT_INTERVAL_MS` | `30000` | Heartbeat tick interval |
| `DATA_DIR` | `.revolut-data` | Directory for session store + transcripts |

## WebSocket Protocol

### Connection

First message must be a connect request:

```json
{
  "type": "req",
  "id": "1",
  "method": "connect",
  "params": {
    "client": { "id": "web-ui", "version": "0.1.0", "platform": "browser" },
    "auth": { "token": "your-token" }
  }
}
```

Server replies with `hello-ok` containing supported methods and events.

### Methods

| Method | Description |
|---|---|
| `chat.send` | Send a message to the agent (`{ sessionKey, message }`) |
| `sessions.list` | List all sessions |
| `sessions.create` | Create a session (`{ sessionKey, title }`) |
| `sessions.delete` | Delete a session (`{ sessionKey }`) |
| `sessions.resolve` | Get or create a session (`{ sessionKey }`) |
| `sessions.history` | Get transcript (`{ sessionKey }`) |

### Events

| Event | Description |
|---|---|
| `chat.delta` | Streaming response chunk |
| `chat.message` | Complete assistant response |
| `chat.idle` | Agent turn finished |
| `chat.tool_start` | Tool execution started |
| `chat.tool_complete` | Tool execution finished |
| `tick` | Heartbeat tick |

## Project Structure

```
src/
  protocol/     # TypeBox frame schemas + AJV validators
  queue/        # Lane-aware FIFO command queue
  sessions/     # Session store + JSONL transcripts
  agent/        # Copilot SDK agent runtime
  server/       # WebSocket gateway server
  index.ts      # Entry point
ui/             # React + Vite web chat UI
```
