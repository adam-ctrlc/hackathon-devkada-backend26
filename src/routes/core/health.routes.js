import { prisma } from "../../lib/prisma.js";
import { asyncHandler } from "../../utils/async-handler.js";
import { buildStatusRecommendation } from "../../services/wellness/analysis.service.js";
import { authlessWriteLimiter } from "../../middleware/security.middleware.js";
import { assertSafeTextFields } from "../../services/safety/text-safety.service.js";

export const registerHealthRoutes = (app) => {
  app.get("/health", (req, res) => {
    res.json({
      ok: true,
      service: "kainwise-api",
      tokenEndpoint: "/api/v1/gemini-token",
      method: req.method,
    });
  });

  app.post(
    "/health-context",
    authlessWriteLimiter,
    asyncHandler(async (req, res) => {
      const payload = req.body ?? {};
      if (!payload.profileId) {
        return res.status(400).json({ error: "profileId is required" });
      }

      const profile = await prisma.profile.findUnique({
        where: { id: payload.profileId },
      });
      if (!profile) {
        return res.status(404).json({ error: "Profile not found" });
      }

      assertSafeTextFields([
        { label: "Status", value: payload.status },
        { label: "Personal notes", value: payload.notes },
        { label: "Custom restriction", value: payload.customRestriction },
      ]);

      const context = await prisma.healthContext.upsert({
        where: { profileId: payload.profileId },
        update: {
          status: payload.status?.trim() ?? null,
          notes: payload.notes?.trim() ?? null,
          customRestriction: payload.customRestriction?.trim() ?? null,
        },
        create: {
          profileId: payload.profileId,
          status: payload.status?.trim() ?? null,
          notes: payload.notes?.trim() ?? null,
          customRestriction: payload.customRestriction?.trim() ?? null,
        },
      });

      res.status(201).json({
        healthContext: context,
        recommendation: buildStatusRecommendation(context.status),
      });
    }),
  );
};
