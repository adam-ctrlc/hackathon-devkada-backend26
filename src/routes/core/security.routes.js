import { issueCsrfToken } from "../../middleware/security.middleware.js";
import { asyncHandler } from "../../utils/async-handler.js";
import { createGeminiEphemeralToken } from "../../services/ai/gemini-live.service.js";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Allow-Methods": "GET, HEAD, POST, OPTIONS",
};

export const registerSecurityRoutes = (app) => {
  app.get("/security/csrf", issueCsrfToken);

  app.options("/gemini-token", (req, res) => {
    res.status(204).set(corsHeaders).end();
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
    asyncHandler(async (req, res) => {
      const payload = req.body ?? {};
      const token = await createGeminiEphemeralToken({
        model: payload.model,
        config: payload.config ?? {},
      });

      res.set(corsHeaders).json(token);
    }),
  );
};
