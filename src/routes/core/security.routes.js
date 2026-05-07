import { issueCsrfToken } from "../../middleware/security.middleware.js";
import { asyncHandler } from "../../utils/async-handler.js";
import { createGeminiEphemeralToken } from "../../services/ai/gemini-live.service.js";
import { requireAuth } from "../../middleware/auth.middleware.js";

export const registerSecurityRoutes = (app) => {
  app.get("/security/csrf", issueCsrfToken);

  app.options("/gemini-token", (req, res) => {
    res.status(204).end();
  });

  app.get("/gemini-token", (req, res) => {
    res
      .status(405)
      .set({ Allow: "POST, OPTIONS" })
      .json({
        error: `/api/v1/gemini-token requires POST, received ${req.method}`,
      });
  });

  app.post(
    "/gemini-token",
    requireAuth,
    asyncHandler(async (req, res) => {
      const payload = req.body ?? {};
      const token = await createGeminiEphemeralToken({
        model: payload.model,
        config: payload.config ?? {},
      });

      res.json(token);
    }),
  );
};
