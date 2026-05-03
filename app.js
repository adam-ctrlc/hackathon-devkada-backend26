import { createApp } from "./src/app.js";
import { env } from "./src/config/env.js";
import { connectDatabase } from "./src/lib/prisma.js";

const app = createApp();

const start = async () => {
  await connectDatabase();

  app.listen(env.port, () => {
    console.log(`KainWise API listening on http://localhost:${env.port}`);
  });
};

start().catch((error) => {
  console.error("Failed to start API server:", error);
  process.exit(1);
});
