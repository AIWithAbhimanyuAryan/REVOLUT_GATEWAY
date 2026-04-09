import { useCallback, useEffect, useRef, useState } from "react";

export interface SessionEntry {
  sessionId: string;
  sessionKey: string;
  createdAt: string;
  lastActiveAt: string;
  title?: string;
}

export interface ChatMessage {
  role: "user" | "assistant" | "system";
  content: string;
  ts: string;
  streaming?: boolean;
}

type ConnectionState = "disconnected" | "connecting" | "connected";

interface GatewayHook {
  state: ConnectionState;
  sessions: SessionEntry[];
  messages: ChatMessage[];
  activeSession: string;
  connect: (url: string, token?: string) => void;
  disconnect: () => void;
  sendMessage: (message: string) => void;
  createSession: (key: string, title?: string) => void;
  switchSession: (key: string) => void;
  deleteSession: (key: string) => void;
}

let reqId = 0;
function nextId(): string {
  return String(++reqId);
}

export function useGateway(): GatewayHook {
  const wsRef = useRef<WebSocket | null>(null);
  const [state, setState] = useState<ConnectionState>("disconnected");
  const [sessions, setSessions] = useState<SessionEntry[]>([]);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [activeSession, setActiveSession] = useState("main");
  const streamingRef = useRef("");
  const pendingCallbacks = useRef<Map<string, (payload: any) => void>>(new Map());

  const sendReq = useCallback(
    (method: string, params?: unknown): Promise<any> => {
      return new Promise((resolve, reject) => {
        const ws = wsRef.current;
        if (!ws || ws.readyState !== WebSocket.OPEN) {
          reject(new Error("Not connected"));
          return;
        }
        const id = nextId();
        pendingCallbacks.current.set(id, resolve);
        const payloadStr = JSON.stringify({ type: "req", id, method, params });
        console.log(`[UI -> WS] Sending:`, payloadStr);
        ws.send(payloadStr);
        setTimeout(() => {
          if (pendingCallbacks.current.has(id)) {
            pendingCallbacks.current.delete(id);
            reject(new Error("Request timed out"));
          }
        }, 30000);
      });
    },
    [],
  );

  const loadHistory = useCallback(
    async (sessionKey: string) => {
      try {
        const result = await sendReq("sessions.history", { sessionKey });
        if (result?.messages) {
          setMessages(
            result.messages.map((m: any) => ({
              role: m.role,
              content: m.content,
              ts: m.ts,
            })),
          );
        }
      } catch {
        setMessages([]);
      }
    },
    [sendReq],
  );

  const loadSessions = useCallback(async () => {
    try {
      const result = await sendReq("sessions.list");
      if (result?.sessions) {
        setSessions(result.sessions);
      }
    } catch {
      // ignore
    }
  }, [sendReq]);

  const connect = useCallback(
    (url: string, token?: string) => {
      if (wsRef.current) {
        wsRef.current.close();
      }
      setState("connecting");
      const ws = new WebSocket(url);
      wsRef.current = ws;

      ws.onopen = () => {
        const connectReq = {
          type: "req",
          id: nextId(),
          method: "connect",
          params: {
            client: { id: "web-ui", version: "0.1.0", platform: "browser" },
            ...(token ? { auth: { token } } : {}),
          },
        };
        const id = connectReq.id;
        pendingCallbacks.current.set(id, (payload: any) => {
          if (payload?.type === "hello-ok") {
            setState("connected");
            // Load sessions and history after connect
            void loadSessions();
            void loadHistory(activeSession);
          }
        });
        ws.send(JSON.stringify(connectReq));
      };

      ws.onmessage = (ev) => {
        console.log(`[WS -> UI] Received raw:`, ev.data);
        try {
          const frame = JSON.parse(ev.data);

          if (frame.type === "res") {
            const cb = pendingCallbacks.current.get(frame.id);
            if (cb) {
              pendingCallbacks.current.delete(frame.id);
              cb(frame.ok ? frame.payload : null);
            }
            return;
          }

          if (frame.type === "event") {
            handleEvent(frame.event, frame.payload);
          }
        } catch {
          // ignore parse errors
        }
      };

      ws.onclose = () => {
        if (wsRef.current === ws) {
          setState("disconnected");
          wsRef.current = null;
        }
      };

      ws.onerror = () => {
        if (wsRef.current === ws) {
          setState("disconnected");
        }
      };
    },
    [activeSession, loadHistory, loadSessions],
  );

  const handleEvent = useCallback(
    (event: string, payload: any) => {
      switch (event) {
        case "chat.delta": {
          const delta = payload?.content ?? "";
          streamingRef.current += delta;
          setMessages((prev) => {
            const last = prev[prev.length - 1];
            if (last?.streaming) {
              return [
                ...prev.slice(0, -1),
                { ...last, content: streamingRef.current },
              ];
            }
            return [
              ...prev,
              {
                role: "assistant",
                content: streamingRef.current,
                ts: new Date().toISOString(),
                streaming: true,
              },
            ];
          });
          break;
        }
        case "chat.message": {
          const content = payload?.content ?? streamingRef.current;
          streamingRef.current = "";
          setMessages((prev) => {
            const last = prev[prev.length - 1];
            if (last?.streaming) {
              return [
                ...prev.slice(0, -1),
                { role: "assistant", content, ts: new Date().toISOString() },
              ];
            }
            return [
              ...prev,
              { role: "assistant", content, ts: new Date().toISOString() },
            ];
          });
          break;
        }
        case "chat.idle": {
          streamingRef.current = "";
          void loadSessions();
          break;
        }
        case "chat.tool_start":
        case "chat.tool_complete":
          // Could show tool indicators — skip for simplicity
          break;
        case "chat.error": {
          const errMsg = payload?.error || "Unknown error";
          streamingRef.current = "";
          setMessages((prev) => {
            const last = prev[prev.length - 1];
            const newMsg = { role: "assistant" as const, content: `⚠️ Error: ${errMsg}`, ts: new Date().toISOString() };
            if (last?.streaming) return [...prev.slice(0, -1), newMsg];
            return [...prev, newMsg];
          });
          void loadSessions();
          break;
        }
        default:
          break;
      }
    },
    [loadSessions],
  );

  const disconnect = useCallback(() => {
    wsRef.current?.close();
    wsRef.current = null;
    setState("disconnected");
  }, []);

  const sendMessage = useCallback(
    (message: string) => {
      setMessages((prev) => [
        ...prev,
        { role: "user", content: message, ts: new Date().toISOString() },
      ]);
      streamingRef.current = "";
      void sendReq("chat.send", { sessionKey: activeSession, message });
    },
    [activeSession, sendReq],
  );

  const createSession = useCallback(
    (key: string, title?: string) => {
      void sendReq("sessions.create", { sessionKey: key, title }).then(() => {
        void loadSessions();
        setActiveSession(key);
        setMessages([]);
      });
    },
    [sendReq, loadSessions],
  );

  const switchSession = useCallback(
    (key: string) => {
      setActiveSession(key);
      streamingRef.current = "";
      void loadHistory(key);
    },
    [loadHistory],
  );

  const deleteSession = useCallback(
    (key: string) => {
      void sendReq("sessions.delete", { sessionKey: key }).then(() => {
        void loadSessions();
        if (activeSession === key) {
          setActiveSession("main");
          setMessages([]);
        }
      });
    },
    [sendReq, loadSessions, activeSession],
  );

  // Auto-connect on mount
  useEffect(() => {
    connect("ws://localhost:18800");
    return () => disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return {
    state,
    sessions,
    messages,
    activeSession,
    connect,
    disconnect,
    sendMessage,
    createSession,
    switchSession,
    deleteSession,
  };
}
