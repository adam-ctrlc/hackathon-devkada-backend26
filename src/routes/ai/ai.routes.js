import { prisma } from "../../lib/prisma.js";
import { asyncHandler } from "../../utils/async-handler.js";
import {
  analyzeDiary,
  analyzeScan,
  analyzeWeekly,
  generateWorkoutSuggestions,
} from "../../services/ai/ai.service.js";
import { scoreFood } from "../../services/wellness/wellness.service.js";
import { buildJournalRagContext } from "../../services/wellness/journal-rag.service.js";
import { aiRouteLimiter } from "../../middleware/security.middleware.js";

export const registerAiRoutes = (app) => {
  app.post(
    "/ai/analyze",
    aiRouteLimiter,
    asyncHandler(async (req, res) => {
      const payload = req.body ?? {};
      const kind = payload.kind ?? "weekly";

      if (!payload.profileId) {
        return res.status(400).json({ error: "profileId is required" });
      }

      const profile = await prisma.profile.findUnique({
        where: { id: payload.profileId },
        include: {
          healthContext: true,
          scans: { orderBy: { createdAt: "desc" }, take: 10 },
          diaryEntries: { orderBy: { createdAt: "desc" }, take: 10 },
          dailySummaries: { orderBy: { date: "desc" }, take: 7 },
        },
      });

      if (!profile) {
        return res.status(404).json({ error: "Profile not found" });
      }

      switch (kind) {
        case "scan": {
          const nutrition = payload.nutrition ?? {};
          const scoreResult = scoreFood({
            nutrition,
            productName: payload.productName ?? "Food item",
            profile,
            healthStatus: profile.healthContext?.status ?? null,
          });
          const analysis = await analyzeScan({
            profile,
            healthContext: profile.healthContext,
            productName: payload.productName ?? "Food item",
            nutrition,
            scoreResult,
          });
          return res.json({ analysis, scoreResult });
        }
        case "diary": {
          const entry = String(payload.entry ?? "").trim();
          if (!entry) {
            return res
              .status(400)
              .json({ error: "entry is required for diary analysis" });
          }

          const scanSignals = profile.scans
            .flatMap((scan) => [
              ...(Array.isArray(scan.notes) ? scan.notes : []),
              scan.score < 50 ? "low support" : null,
              (scan.nutrition?.sodiumMg ?? 0) > 600 ? "high sodium" : null,
              (scan.nutrition?.proteinGrams ?? 0) < 10 ? "low protein" : null,
            ])
            .filter(Boolean);
          const reflection = await analyzeDiary({
            profile,
            healthContext: profile.healthContext,
            entry,
            journalContext: await buildJournalRagContext({
              profileId: profile.id,
              queryText: entry,
              currentText: entry,
              limit: 5,
            }),
            moodTag: payload.moodTag?.trim() ?? null,
            energyLevel: payload.energyLevel ? Number(payload.energyLevel) : 3,
            stressLevel: payload.stressLevel ? Number(payload.stressLevel) : 3,
            sleepHours: payload.sleepHours ? Number(payload.sleepHours) : null,
            waterIntakeMl: payload.waterIntakeMl
              ? Number(payload.waterIntakeMl)
              : null,
            activityMinutes: payload.activityMinutes
              ? Number(payload.activityMinutes)
              : null,
            scanSignals,
          });

          return res.json({ analysis: reflection });
        }
        default: {
          const analysis = await analyzeWeekly({
            profile,
            scans: profile.scans,
            diaries: profile.diaryEntries,
            summaries: profile.dailySummaries,
          });
          return res.json({ analysis });
        }
        case "workout": {
          const analysis = await generateWorkoutSuggestions({
            profile,
            healthContext: profile.healthContext,
            maxMinutes: payload.maxMinutes ? Number(payload.maxMinutes) : 45,
            equipment: Array.isArray(payload.equipment)
              ? payload.equipment
              : [],
            source: payload.source ?? "manual",
          });
          return res.json({ analysis });
        }
      }
    }),
  );
};
