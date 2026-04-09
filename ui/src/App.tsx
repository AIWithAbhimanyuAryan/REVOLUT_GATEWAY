import { useState, useRef, useEffect } from "react";
import {
  MessageSquare,
  Plus,
  Trash2,
  Send,
  Wifi,
  WifiOff,
  Loader2,
  Bot,
  User,
} from "lucide-react";
import { useGateway, type SessionEntry } from "./useGateway";

function App() {
  const {
    state,
    sessions,
    messages,
    activeSession,
    sendMessage,
    createSession,
    switchSession,
    deleteSession,
  } = useGateway();

  const [input, setInput] = useState("");
  const [newSessionKey, setNewSessionKey] = useState("");
  const [showNewSession, setShowNewSession] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const handleSend = () => {
    const text = input.trim();
    if (!text) return;
    setInput("");
    sendMessage(text);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleCreateSession = () => {
    const key = newSessionKey.trim();
    if (!key) return;
    createSession(key, key);
    setNewSessionKey("");
    setShowNewSession(false);
  };

  return (
    <div className="flex h-screen bg-gray-950">
      {/* Sidebar */}
      <aside className="w-64 bg-gray-900 border-r border-gray-800 flex flex-col">
        {/* Header */}
        <div className="p-4 border-b border-gray-800">
          <h1 className="text-lg font-bold text-white flex items-center gap-2">
            <Bot className="w-5 h-5 text-blue-400" />
            Revolut Gateway
          </h1>
          <div className="flex items-center gap-1.5 mt-1.5">
            {state === "connected" ? (
              <Wifi className="w-3.5 h-3.5 text-green-400" />
            ) : state === "connecting" ? (
              <Loader2 className="w-3.5 h-3.5 text-yellow-400 animate-spin" />
            ) : (
              <WifiOff className="w-3.5 h-3.5 text-red-400" />
            )}
            <span className="text-xs text-gray-400">
              {state === "connected"
                ? "Connected"
                : state === "connecting"
                  ? "Connecting..."
                  : "Disconnected"}
            </span>
          </div>
        </div>

        {/* Sessions */}
        <div className="flex-1 overflow-y-auto p-2">
          <div className="flex items-center justify-between px-2 py-1.5 mb-1">
            <span className="text-xs font-semibold text-gray-500 uppercase tracking-wider">
              Sessions
            </span>
            <button
              onClick={() => setShowNewSession(true)}
              className="p-1 hover:bg-gray-800 rounded text-gray-400 hover:text-white transition-colors"
              title="New session"
            >
              <Plus className="w-4 h-4" />
            </button>
          </div>

          {showNewSession && (
            <div className="px-2 pb-2">
              <input
                type="text"
                value={newSessionKey}
                onChange={(e) => setNewSessionKey(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleCreateSession()}
                placeholder="Session name..."
                className="w-full px-2 py-1.5 bg-gray-800 border border-gray-700 rounded text-sm text-gray-200 placeholder-gray-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                autoFocus
              />
            </div>
          )}

          {sessions.length === 0 && !showNewSession && (
            <p className="px-2 py-4 text-xs text-gray-600 text-center">
              No sessions yet
            </p>
          )}

          {sessions.map((s: SessionEntry) => (
            <div
              key={s.sessionKey}
              className={`group flex items-center gap-2 px-3 py-2 rounded-lg cursor-pointer transition-colors ${
                activeSession === s.sessionKey
                  ? "bg-gray-800 text-white"
                  : "text-gray-400 hover:bg-gray-800/50 hover:text-gray-200"
              }`}
              onClick={() => switchSession(s.sessionKey)}
            >
              <MessageSquare className="w-4 h-4 flex-shrink-0" />
              <span className="flex-1 truncate text-sm">
                {s.title || s.sessionKey}
              </span>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  deleteSession(s.sessionKey);
                }}
                className="opacity-0 group-hover:opacity-100 p-0.5 hover:text-red-400 transition-all"
                title="Delete session"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </div>
          ))}
        </div>

        {/* Footer */}
        <div className="p-3 border-t border-gray-800 text-xs text-gray-600">
          OpenClaw-style gateway
        </div>
      </aside>

      {/* Main chat area */}
      <main className="flex-1 flex flex-col">
        {/* Chat header */}
        <header className="px-6 py-3 border-b border-gray-800 bg-gray-900/50">
          <h2 className="text-sm font-medium text-gray-300">
            Session:{" "}
            <span className="text-white font-semibold">{activeSession}</span>
          </h2>
        </header>

        {/* Messages */}
        <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
          {messages.length === 0 && (
            <div className="flex flex-col items-center justify-center h-full text-gray-600">
              <Bot className="w-12 h-12 mb-3 text-gray-700" />
              <p className="text-sm">
                Send a message to start the conversation
              </p>
            </div>
          )}

          {messages.map((msg, i) => (
            <div
              key={i}
              className={`flex gap-3 ${
                msg.role === "user" ? "justify-end" : "justify-start"
              }`}
            >
              {msg.role !== "user" && (
                <div className="w-8 h-8 rounded-full bg-blue-600/20 flex items-center justify-center flex-shrink-0 mt-0.5">
                  <Bot className="w-4 h-4 text-blue-400" />
                </div>
              )}
              <div
                className={`max-w-[70%] rounded-2xl px-4 py-2.5 text-sm leading-relaxed ${
                  msg.role === "user"
                    ? "bg-blue-600 text-white"
                    : "bg-gray-800 text-gray-200"
                } ${msg.streaming ? "animate-pulse" : ""}`}
              >
                <p className="whitespace-pre-wrap">{msg.content}</p>
                {msg.streaming && (
                  <span className="inline-block w-1.5 h-4 bg-blue-400 ml-0.5 animate-pulse rounded" />
                )}
              </div>
              {msg.role === "user" && (
                <div className="w-8 h-8 rounded-full bg-gray-700 flex items-center justify-center flex-shrink-0 mt-0.5">
                  <User className="w-4 h-4 text-gray-300" />
                </div>
              )}
            </div>
          ))}
          <div ref={messagesEndRef} />
        </div>

        {/* Input */}
        <div className="px-6 py-4 border-t border-gray-800 bg-gray-900/50">
          <div className="flex items-end gap-3">
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={
                state === "connected"
                  ? "Type a message..."
                  : "Connecting to gateway..."
              }
              disabled={state !== "connected"}
              rows={1}
              className="flex-1 resize-none rounded-xl bg-gray-800 border border-gray-700 px-4 py-3 text-sm text-gray-200 placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent disabled:opacity-50 disabled:cursor-not-allowed"
            />
            <button
              onClick={handleSend}
              disabled={state !== "connected" || !input.trim()}
              className="p-3 rounded-xl bg-blue-600 text-white hover:bg-blue-500 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
            >
              <Send className="w-4 h-4" />
            </button>
          </div>
        </div>
      </main>
    </div>
  );
}

export default App;
