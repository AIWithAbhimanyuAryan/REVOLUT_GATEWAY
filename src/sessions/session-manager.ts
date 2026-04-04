import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";

export interface SessionEntry {
  sessionId: string;
  sessionKey: string;
  createdAt: string;
  lastActiveAt: string;
  title?: string;
}

export interface TranscriptMessage {
  role: "user" | "assistant" | "system";
  content: string;
  ts: string;
  sessionId: string;
}

export class SessionManager {
  private storePath: string;
  private transcriptsDir: string;
  private store: Record<string, SessionEntry> = {};

  constructor(dataDir: string) {
    this.storePath = path.join(dataDir, "sessions.json");
    this.transcriptsDir = path.join(dataDir, "transcripts");
  }

  async init(): Promise<void> {
    await fsp.mkdir(path.dirname(this.storePath), { recursive: true });
    await fsp.mkdir(this.transcriptsDir, { recursive: true });
    try {
      const raw = await fsp.readFile(this.storePath, "utf-8");
      this.store = JSON.parse(raw);
    } catch {
      this.store = {};
    }
  }

  private async saveStore(): Promise<void> {
    await fsp.writeFile(this.storePath, JSON.stringify(this.store, null, 2));
  }

  getSession(sessionKey: string): SessionEntry | undefined {
    return this.store[sessionKey];
  }

  listSessions(): SessionEntry[] {
    return Object.values(this.store).sort(
      (a, b) => new Date(b.lastActiveAt).getTime() - new Date(a.lastActiveAt).getTime(),
    );
  }

  async createSession(sessionKey: string, title?: string): Promise<SessionEntry> {
    const existing = this.store[sessionKey];
    if (existing) return existing;

    const now = new Date().toISOString();
    const suffix = crypto.randomUUID().slice(0, 8);
    const ts = now.replace(/[:.]/g, "-").replace("T", "_").replace("Z", "");
    const sessionId = `sess-${ts}-${suffix}`;

    const entry: SessionEntry = {
      sessionId,
      sessionKey,
      createdAt: now,
      lastActiveAt: now,
      title: title ?? sessionKey,
    };
    this.store[sessionKey] = entry;
    await this.saveStore();
    return entry;
  }

  async deleteSession(sessionKey: string): Promise<boolean> {
    const entry = this.store[sessionKey];
    if (!entry) return false;
    delete this.store[sessionKey];
    await this.saveStore();
    const transcriptPath = path.join(this.transcriptsDir, `${entry.sessionId}.jsonl`);
    try {
      await fsp.unlink(transcriptPath);
    } catch {
      // file may not exist
    }
    return true;
  }

  async appendMessage(sessionKey: string, msg: Omit<TranscriptMessage, "ts" | "sessionId">): Promise<void> {
    const entry = this.store[sessionKey];
    if (!entry) throw new Error(`Session not found: ${sessionKey}`);

    const full: TranscriptMessage = {
      ...msg,
      ts: new Date().toISOString(),
      sessionId: entry.sessionId,
    };

    const transcriptPath = path.join(this.transcriptsDir, `${entry.sessionId}.jsonl`);
    await fsp.appendFile(transcriptPath, JSON.stringify(full) + "\n");

    entry.lastActiveAt = full.ts;
    await this.saveStore();
  }

  async readTranscript(sessionKey: string): Promise<TranscriptMessage[]> {
    const entry = this.store[sessionKey];
    if (!entry) return [];

    const transcriptPath = path.join(this.transcriptsDir, `${entry.sessionId}.jsonl`);
    try {
      const raw = await fsp.readFile(transcriptPath, "utf-8");
      return raw
        .split("\n")
        .filter((line) => line.trim())
        .map((line) => JSON.parse(line) as TranscriptMessage);
    } catch {
      return [];
    }
  }

  async resolveOrCreate(sessionKey: string): Promise<SessionEntry> {
    const existing = this.store[sessionKey];
    if (existing) return existing;
    return this.createSession(sessionKey);
  }
}
