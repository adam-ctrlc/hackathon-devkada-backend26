import { prisma } from "../../lib/prisma.js";
import { asyncHandler } from "../../utils/async-handler.js";
import { refreshDailySummary } from "../../services/wellness/daily-summary.service.js";
import crypto from "node:crypto";
import { analyzeDiary } from "../../services/ai/ai.service.js";
import { buildDiaryReflection } from "../../services/wellness/wellness.service.js";
import {
  buildJournalRagContext,
  indexDiaryEntryChunks,
} from "../../services/wellness/journal-rag.service.js";
import { authlessWriteLimiter } from "../../middleware/security.middleware.js";
import { requireProfileAccess } from "../../services/profile/profile-access.service.js";

const hashPin = (pin) =>
  crypto.createHash("sha256").update(String(pin)).digest("hex");
const getPin = (req) =>
  req.headers["x-diary-pin"] ?? req.query.pin ?? req.body?.pin;

export const registerDiaryRoutes = (app) => {
  app.post(
    "/diary",
    authlessWriteLimiter,
    asyncHandler(async (req, res) => {
      const payload = req.body ?? {};

      if (!payload.profileId) {
        return res.status(400).json({ error: "profileId is required" });
      }

      if (!payload.entry?.trim()) {
        return res.status(400).json({ error: "entry is required" });
      }

      const profile = await prisma.profile.findUnique({
        where: { id: payload.profileId },
        include: { scans: { orderBy: { createdAt: "desc" }, take: 5 } },
      });

      if (!profile) {
        return res.status(404).json({ error: "Profile not found" });
      }

      const scanSignals = profile.scans
        .flatMap((scan) => [
          ...(Array.isArray(scan.notes) ? scan.notes : []),
          scan.score < 50 ? "low support" : null,
          (scan.nutrition?.sodiumMg ?? 0) > 600 ? "high sodium" : null,
          (scan.nutrition?.proteinGrams ?? 0) < 10 ? "low protein" : null,
        ])
        .filter(Boolean);

      const entry = payload.entry.trim();
      const journalContext = await buildJournalRagContext({
        profileId: payload.profileId,
        queryText: entry,
        currentText: entry,
        limit: 5,
      });
      const aiReflectionResult = await analyzeDiary({
        profile,
        healthContext: profile.healthContext,
        entry,
        journalContext,
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
      const aiReflection =
        aiReflectionResult?.reflection ??
        buildDiaryReflection({
          entry,
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

      const diary = await prisma.diaryEntry.create({
        data: {
          profileId: payload.profileId,
          moodTag: payload.moodTag?.trim() ?? null,
          energyLevel: payload.energyLevel ? Number(payload.energyLevel) : null,
          stressLevel: payload.stressLevel ? Number(payload.stressLevel) : null,
          sleepHours: payload.sleepHours ? Number(payload.sleepHours) : null,
          waterIntakeMl: payload.waterIntakeMl
            ? Number(payload.waterIntakeMl)
            : null,
          activityMinutes: payload.activityMinutes
            ? Number(payload.activityMinutes)
            : null,
          weightKg: payload.weightKg ? Number(payload.weightKg) : null,
          symptoms: Array.isArray(payload.symptoms) ? payload.symptoms : null,
          entry,
          aiReflection,
        },
      });

      await indexDiaryEntryChunks({
        profileId: payload.profileId,
        diaryEntryId: diary.id,
        entry,
      });

      await refreshDailySummary(payload.profileId, diary.createdAt);

      res.status(201).json({ diary, aiReflectionResult, journalContext });
    }),
  );

  app.get(
    "/diary/:profileId",
    asyncHandler(async (req, res) => {
      const profile = await prisma.profile.findUnique({
        where: { id: req.params.profileId },
        select: {
          id: true,
          role: true,
          parentProfileId: true,
          diaryPinHash: true,
        },
      });

      if (!profile) {
        return res.status(404).json({ error: "Profile not found" });
      }

      const access = await requireProfileAccess(req, res, profile);
      if (!access.allowed) {
        return;
      }

      if (
        profile.diaryPinHash &&
        ["Self access", "Legacy self-access"].includes(access.access.reason)
      ) {
        const pin = getPin(req);
        if (!pin || hashPin(pin) !== profile.diaryPinHash) {
          return res.status(403).json({ error: "Diary locked" });
        }
      }

      const entries = await prisma.diaryEntry.findMany({
        where: { profileId: req.params.profileId },
        orderBy: { createdAt: "desc" },
        take: 20,
      });

      res.json({ entries });
    }),
  );
};
