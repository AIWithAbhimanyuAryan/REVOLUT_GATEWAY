import { CopilotClient, approveAll } from "@github/copilot-sdk";

async function run() {
  const models = [
    "claude-sonnet-4.5",
    "claude-3.5-sonnet",
    "gpt-4",
    "o1-preview"
  ];
  const client = new CopilotClient({ autoStart: true });
  await client.start();

  for (const model of models) {
    try {
      console.log("-------------------");
      console.log(`Testing model: ${model}`);
      const session = await client.createSession({ model, onPermissionRequest: approveAll });
      
      let resolved = false;
      await new Promise((resolve) => {
        session.on("session.error", (e) => {
          console.log(`[${model}] Error event:`, e);
          if (!resolved) { resolved = true; resolve(); }
        });
        session.on("assistant.message", (e) => {
           console.log(`[${model}] Message:`, e.data?.content?.substring(0, 50));
        });
        session.on("session.idle", () => {
           console.log(`[${model}] Idle. Done.`);
           if (!resolved) { resolved = true; resolve(); }
        });
        session.send({ prompt: "Say hi" });
      });
    } catch (e) {
      console.log(`[${model}] Threw error:`, e.message);
    }
  }
  process.exit(0);
}

run().catch(console.log);
