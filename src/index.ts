import "dotenv/config";
import { SessionManager } from "./sessions/session-manager.js";
import { AgentRuntime } from "./agent/agent-runtime.js";
import { GatewayServer } from "./server/gateway-server.js";

const PORT = parseInt(process.env.GATEWAY_PORT ?? "18800", 10);
const TOKEN = process.env.GATEWAY_TOKEN || undefined;
const HEARTBEAT_MS = parseInt(process.env.HEARTBEAT_INTERVAL_MS ?? "30000", 10);
const DATA_DIR = process.env.DATA_DIR ?? ".billy-data";

async function main() {
  console.log("[billy] Starting Billy Gateway...");

  const sessionManager = new SessionManager(DATA_DIR);
  await sessionManager.init();
  console.log("[billy] Session manager ready");

  const agentRuntime = new AgentRuntime(sessionManager);
  await agentRuntime.start();

  const gateway = new GatewayServer({
    port: PORT,
    token: TOKEN,
    heartbeatIntervalMs: HEARTBEAT_MS,
    sessionManager,
    agentRuntime,
  });

  await gateway.start();
  console.log(`[billy] Billy Gateway running on ws://localhost:${PORT}`);

  const shutdown = async (signal: string) => {
    console.log(`\n[billy] Received ${signal}, shutting down...`);
    await gateway.stop();
    await agentRuntime.stop();
    process.exit(0);
  };

  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));
}

main().catch((err) => {
  console.error("[billy] Fatal error:", err);
  process.exit(1);
});
