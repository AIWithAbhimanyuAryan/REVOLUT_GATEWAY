import { createServer, type IncomingMessage, type Server as HttpServer } from "node:http";
import crypto from "node:crypto";
import { WebSocketServer, WebSocket } from "ws";
import type { SessionManager } from "../sessions/session-manager.js";
import type { AgentRuntime, AgentTurnCallback } from "../agent/agent-runtime.js";
import {
  validateConnectParams,
  validateRequestFrame,
  formatValidationErrors,
  type ConnectParams,
  type RequestFrame,
  type ResponseFrame,
  type EventFrame,
  type HelloOk,
} from "../protocol/index.js";

const PROTOCOL_VERSION = 1;
const SERVER_VERSION = "0.1.0";

const METHODS = [
  "chat.send",
  "sessions.list",
  "sessions.create",
  "sessions.delete",
  "sessions.resolve",
  "sessions.history",
] as const;

const EVENTS = ["chat.delta", "chat.message", "chat.idle", "chat.tool", "tick"] as const;

export interface GatewayServerOptions {
  port: number;
  token?: string;
  heartbeatIntervalMs: number;
  sessionManager: SessionManager;
  agentRuntime: AgentRuntime;
}

interface GatewayClient {
  connId: string;
  ws: WebSocket;
  authenticated: boolean;
  subscribedSession?: string;
}

export class GatewayServer {
  private httpServer: HttpServer;
  private wss: WebSocketServer;
  private clients = new Map<string, GatewayClient>();
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private eventSeq = 0;
  private opts: GatewayServerOptions;

  constructor(opts: GatewayServerOptions) {
    this.opts = opts;

    this.httpServer = createServer((req, res) => {
      if (req.url === "/health") {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: true, clients: this.clients.size }));
        return;
      }
      // Serve a simple redirect to the UI for the root path
      if (req.url === "/" || req.url === "") {
        res.writeHead(200, { "Content-Type": "text/html" });
        res.end(`<html><body><h1>Revolut Gateway</h1><p>WebSocket endpoint: ws://localhost:${opts.port}</p></body></html>`);
        return;
      }
      res.writeHead(404);
      res.end("Not Found");
    });

    this.wss = new WebSocketServer({ server: this.httpServer });
    this.wss.on("connection", (ws, req) => this.handleConnection(ws, req));
  }

  async start(): Promise<void> {
    return new Promise((resolve) => {
      this.httpServer.listen(this.opts.port, () => {
        console.log(`[gateway] Listening on port ${this.opts.port}`);
        this.startHeartbeat();
        resolve();
      });
    });
  }

  async stop(): Promise<void> {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
    for (const client of this.clients.values()) {
      client.ws.close(1001, "Gateway shutting down");
    }
    this.clients.clear();

    return new Promise((resolve) => {
      this.wss.close(() => {
        this.httpServer.close(() => resolve());
      });
    });
  }

  private startHeartbeat(): void {
    this.heartbeatTimer = setInterval(() => {
      this.broadcastEvent("tick", { ts: Date.now() });
    }, this.opts.heartbeatIntervalMs);
  }

  private handleConnection(ws: WebSocket, req: IncomingMessage): void {
    const connId = crypto.randomUUID().slice(0, 12);
    const client: GatewayClient = { connId, ws, authenticated: false };

    // First message must be a connect handshake
    ws.once("message", (data) => {
      console.log(`[gateway] Raw Handshake from ${connId}:`, data.toString());
      try {
        const raw = JSON.parse(data.toString());
        if (!raw || raw.type !== "req" || raw.method !== "connect") {
          this.sendError(ws, raw?.id ?? "0", "PROTOCOL_ERROR", "First message must be a connect request");
          ws.close(4001, "Expected connect");
          return;
        }

        const params = raw.params as ConnectParams;
        if (!validateConnectParams(params)) {
          this.sendError(ws, raw.id, "VALIDATION_ERROR", formatValidationErrors(validateConnectParams.errors));
          ws.close(4002, "Invalid connect params");
          return;
        }

        // Token auth check
        if (this.opts.token && params.auth?.token !== this.opts.token) {
          this.sendError(ws, raw.id, "AUTH_ERROR", "Invalid or missing token");
          ws.close(4003, "Unauthorized");
          return;
        }

        client.authenticated = true;
        this.clients.set(connId, client);

        // Send hello-ok
        const hello: HelloOk = {
          type: "hello-ok",
          protocol: PROTOCOL_VERSION,
          server: { version: SERVER_VERSION, connId },
          features: {
            methods: [...METHODS],
            events: [...EVENTS],
          },
        };

        const res: ResponseFrame = {
          type: "res",
          id: raw.id,
          ok: true,
          payload: hello,
        };
        const resStr = JSON.stringify(res);
        console.log(`[gateway] -> Sending to ${connId}:`, resStr);
        ws.send(resStr);
        console.log(`[gateway] Client connected: ${connId} (${params.client.id})`);

        // Now listen for further messages
        ws.on("message", (msg) => {
          console.log(`[gateway] <- Received from ${connId}:`, msg.toString());
          this.handleMessage(client, msg.toString());
        });
      } catch (err) {
        this.sendError(ws, "0", "PARSE_ERROR", "Invalid JSON");
        ws.close(4000, "Parse error");
      }
    });

    ws.on("close", () => {
      this.clients.delete(connId);
      console.log(`[gateway] Client disconnected: ${connId}`);
    });

    ws.on("error", (err) => {
      console.error(`[gateway] WebSocket error for ${connId}:`, err.message);
    });
  }

  private async handleMessage(client: GatewayClient, raw: string): Promise<void> {
    let frame: RequestFrame;
    try {
      const parsed = JSON.parse(raw);
      if (parsed.type !== "req") return; // ignore non-request frames from client
      if (!validateRequestFrame(parsed)) {
        this.sendError(client.ws, parsed?.id ?? "0", "VALIDATION_ERROR", "Invalid request frame");
        return;
      }
      frame = parsed as RequestFrame;
    } catch {
      this.sendError(client.ws, "0", "PARSE_ERROR", "Invalid JSON");
      return;
    }

    try {
      const result = await this.routeMethod(client, frame);
      const res: ResponseFrame = {
        type: "res",
        id: frame.id,
        ok: true,
        payload: result,
      };
      const resStr = JSON.stringify(res);
      console.log(`[gateway] -> Sending to ${client.connId}:`, resStr);
      client.ws.send(resStr);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.sendError(client.ws, frame.id, "METHOD_ERROR", message);
    }
  }

  private async routeMethod(client: GatewayClient, frame: RequestFrame): Promise<unknown> {
    const params = frame.params as Record<string, unknown> | undefined;

    switch (frame.method) {
      case "chat.send":
        return this.handleChatSend(client, params);
      case "sessions.list":
        return this.handleSessionsList();
      case "sessions.create":
        return this.handleSessionsCreate(params);
      case "sessions.delete":
        return this.handleSessionsDelete(params);
      case "sessions.resolve":
        return this.handleSessionsResolve(params);
      case "sessions.history":
        return this.handleSessionsHistory(params);
      default:
        throw new Error(`Unknown method: ${frame.method}`);
    }
  }

  // ── Method handlers ──────────────────────────────────────────────────

  private async handleChatSend(
    client: GatewayClient,
    params: Record<string, unknown> | undefined,
  ): Promise<{ status: string }> {
    const sessionKey = (params?.sessionKey as string) || "main";
    const message = params?.message as string;
    if (!message) throw new Error("Missing 'message' param");

    await this.opts.sessionManager.resolveOrCreate(sessionKey);
    client.subscribedSession = sessionKey;

    const onEvent: AgentTurnCallback = (event) => {
      const eventFrame: EventFrame = {
        type: "event",
        event: `chat.${event.type}`,
        payload: { sessionKey, ...event },
        seq: this.eventSeq++,
      };
      const json = JSON.stringify(eventFrame);
      console.log(`[gateway] -> Broadcasting event:`, json);
      // Broadcast to all clients subscribed to this session
      for (const c of this.clients.values()) {
        if (c.subscribedSession === sessionKey && c.ws.readyState === WebSocket.OPEN) {
          c.ws.send(json);
        }
      }
    };

    // Fire and forget — the response events stream back via WS events
    console.log("[gateway] Handing off chat to agentRuntime:", { sessionKey, message });
    void this.opts.agentRuntime.runTurn(sessionKey, message, onEvent).catch((err) => {
      onEvent({ type: "error", error: err instanceof Error ? err.message : String(err) });
    });

    return { status: "queued" };
  }

  private async handleSessionsList(): Promise<{ sessions: unknown[] }> {
    return { sessions: this.opts.sessionManager.listSessions() };
  }

  private async handleSessionsCreate(
    params: Record<string, unknown> | undefined,
  ): Promise<unknown> {
    const sessionKey = (params?.sessionKey as string) || "main";
    const title = params?.title as string | undefined;
    return this.opts.sessionManager.createSession(sessionKey, title);
  }

  private async handleSessionsDelete(
    params: Record<string, unknown> | undefined,
  ): Promise<{ deleted: boolean }> {
    const sessionKey = params?.sessionKey as string;
    if (!sessionKey) throw new Error("Missing 'sessionKey' param");
    const deleted = await this.opts.sessionManager.deleteSession(sessionKey);
    return { deleted };
  }

  private async handleSessionsResolve(
    params: Record<string, unknown> | undefined,
  ): Promise<unknown> {
    const sessionKey = (params?.sessionKey as string) || "main";
    return this.opts.sessionManager.resolveOrCreate(sessionKey);
  }

  private async handleSessionsHistory(
    params: Record<string, unknown> | undefined,
  ): Promise<{ messages: unknown[] }> {
    const sessionKey = (params?.sessionKey as string) || "main";
    const messages = await this.opts.sessionManager.readTranscript(sessionKey);
    return { messages };
  }

  // ── Helpers ──────────────────────────────────────────────────────────

  private sendError(ws: WebSocket, id: string, code: string, message: string): void {
    const res: ResponseFrame = {
      type: "res",
      id,
      ok: false,
      error: { code, message },
    };
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(res));
    }
  }

  private broadcastEvent(event: string, payload: unknown): void {
    const frame: EventFrame = {
      type: "event",
      event,
      payload,
      seq: this.eventSeq++,
    };
    const json = JSON.stringify(frame);
    for (const client of this.clients.values()) {
      if (client.ws.readyState === WebSocket.OPEN) {
        client.ws.send(json);
      }
    }
  }
}
