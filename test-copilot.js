import { CopilotClient, approveAll } from "@github/copilot-sdk";

async function run() {
  const client = new CopilotClient({ autoStart: true });
  await client.start();
  console.log("Client started");
  
  const session = await client.createSession({
    model: "gpt-4o",
    onPermissionRequest: approveAll
  });
  console.log("Session created");
  
  session.on((event) => {
    console.log("Event:", event.type, event.data?.content || event.data?.name || "");
  });

  console.log("Sending prompt");
  await session.send({ prompt: "Say hello!" });
  console.log("Prompt sent. Waiting for idle...");
}
run().catch(console.error);
