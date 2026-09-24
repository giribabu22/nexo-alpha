import { app } from "./app.js";
import { startHapiServer } from "@nexo-alpha/hapi";

async function main() {
  await app.start();

  const PORT = Number(process.env.PORT) || 4000;
  const server = await startHapiServer(app, {
    port: PORT
  });

  console.log(`✨ Nexo Backend ready at ${server.info.uri}`);

  // Graceful shutdown handling
  const shutdown = async (signal: string) => {
    console.log(`\n${signal} received. Gracefully stopping Nexo server...`);
    try {
      await server.stop({ timeout: 5000 });
      await app.stop();
      console.log("Nexo server gracefully stopped.");
      process.exit(0);
    } catch (err) {
      console.error("Error during graceful shutdown:", err);
      process.exit(1);
    }
  };

  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));
}

main().catch((err) => {
  console.error("Failed to start Nexo backend:", err);
  process.exit(1);
});
