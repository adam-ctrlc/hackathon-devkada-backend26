import express from "express";
import cookieParser from "cookie-parser";
import { registerRootRoutes } from "./routes/core/root.routes.js";
import { registerProfileRoutes } from "./routes/account/profiles.routes.js";
import { registerHealthRoutes } from "./routes/core/health.routes.js";
import { registerAuthRoutes } from "./routes/core/auth.routes.js";
import { registerScanRoutes } from "./routes/nutrition/scans.routes.js";
import { registerDiaryRoutes } from "./routes/account/diary.routes.js";
import { registerDashboardRoutes } from "./routes/account/dashboard.routes.js";
import { registerAiRoutes } from "./routes/ai/ai.routes.js";
import { registerMealsRoutes } from "./routes/nutrition/meals.routes.js";
import { registerTaskRoutes } from "./routes/account/tasks.routes.js";
import { registerSecurityRoutes } from "./routes/core/security.routes.js";
import { registerWellnessRoutes } from "./routes/nutrition/wellness.routes.js";
import { registerFitnessRoutes } from "./routes/fitness/fitness.routes.js";
import {
  globalRateLimiter,
  csrfProtection,
} from "./middleware/security.middleware.js";
import {
  jwtContextMiddleware,
  requireDatabase,
} from "./middleware/auth.middleware.js";

export const createApp = () => {
  const app = express();
  const api = express.Router();

  app.use(cookieParser());
  app.use(express.json({ limit: "1mb" }));
  app.use(jwtContextMiddleware);
  app.use("/api/v1", globalRateLimiter);

  registerSecurityRoutes(api);
  registerAuthRoutes(api);
  api.use(csrfProtection);
  api.use(requireDatabase);
  registerRootRoutes(api);
  registerProfileRoutes(api);
  registerHealthRoutes(api);
  registerScanRoutes(api);
  registerDiaryRoutes(api);
  registerDashboardRoutes(api);
  registerAiRoutes(api);
  registerMealsRoutes(api);
  registerTaskRoutes(api);
  registerWellnessRoutes(api);
  registerFitnessRoutes(api);

  app.use("/api/v1", api);

  app.use((req, res) => {
    res.status(404).json({ error: "Route not found" });
  });

  app.use((err, req, res, next) => {
    console.error(err);
    res
      .status(err.status && Number.isFinite(err.status) ? err.status : 500)
      .json({ error: err.message ?? "Internal server error" });
  });

  return app;
};
