import { createApp } from "./src/app.js";
import { env } from "./src/config/env.js";
import { connectDatabase } from "./src/lib/prisma.js";

const app = createApp();

connectDatabase().catch((error) => {
  console.error("Failed to connect to database:", error);
  if (process.env.NODE_ENV !== "production") process.exit(1);
});

if (process.env.NODE_ENV !== "production") {
  app.listen(env.port, () => {
    console.log(`KainWise API listening on http://localhost:${env.port}`);
  });
}

export default app;
