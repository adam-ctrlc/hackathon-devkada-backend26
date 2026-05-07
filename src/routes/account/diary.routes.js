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

const toOptionalNumber = (value) => {
  if (value === undefined || value === null || value === "") {
    return null;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const parseBoolean = (value) =>
  ["1", "true", "yes", "on"].includes(
    String(value ?? "")
      .trim()
      .toLowerCase(),
  );

const normalizeScanSignals = (scans = []) =>
  scans
    .flatMap((scan) => {
      const notes = Array.isArray(scan.notes)
        ? scan.notes
            .map((note) => {
              if (note && typeof note === "object") {
                return String(note.label ?? note.detail ?? note.title ?? "")
                  .trim()
                  .toLowerCase();
              }
              return String(note ?? "")
                .trim()
                .toLowerCase();
            })
            .filter(Boolean)
        : [];

      return [
        ...notes,
        scan.score < 50 ? "low support" : null,
        (scan.nutrition?.sodiumMg ?? 0) > 600 ? "high sodium" : null,
        (scan.nutrition?.proteinGrams ?? 0) < 10 ? "low protein" : null,
      ];
    })
    .filter(Boolean);

const buildDiaryData = ({ payload, entry, aiReflection }) => ({
  moodTag: payload.moodTag?.trim() ?? null,
  energyLevel: toOptionalNumber(payload.energyLevel),
  stressLevel: toOptionalNumber(payload.stressLevel),
  sleepHours: toOptionalNumber(payload.sleepHours),
  waterIntakeMl: toOptionalNumber(payload.waterIntakeMl),
  activityMinutes: toOptionalNumber(payload.activityMinutes),
  weightKg: toOptionalNumber(payload.weightKg),
  symptoms: Array.isArray(payload.symptoms) ? payload.symptoms : null,
  entry,
  aiReflection,
});

const isBlankReflection = (value) => !String(value ?? "").trim();

const runDiaryFollowups = ({ profileId, diaryEntryId, entry, date }) => {
  setImmediate(async () => {
    try {
      if (diaryEntryId && entry) {
        await prisma.diaryChunk.deleteMany({
          where: { diaryEntryId },
        });
        await indexDiaryEntryChunks({
          profileId,
          diaryEntryId,
          entry,
        });
      }

      await refreshDailySummary(profileId, date);
    } catch (error) {
      console.error("diary.followup.error", {
        profileId,
        diaryEntryId,
        message: error?.message ?? "Unknown diary follow-up error",
      });
    }
  });
};

const loadDiaryWithAccess = async (req, res, entryId) => {
  const diary = await prisma.diaryEntry.findUnique({
    where: { id: entryId },
    include: {
      profile: {
        include: {
          healthContext: true,
          scans: { orderBy: { createdAt: "desc" }, take: 5 },
        },
      },
    },
  });

  if (!diary) {
    res.status(404).json({ error: "Diary entry not found" });
    return null;
  }

  const access = await requireProfileAccess(req, res, diary.profile);
  if (!access.allowed) {
    return null;
  }

  return diary;
};

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
        include: {
          healthContext: true,
          scans: { orderBy: { createdAt: "desc" }, take: 5 },
        },
      });

      if (!profile) {
        return res.status(404).json({ error: "Profile not found" });
      }

      const access = await requireProfileAccess(req, res, profile);
      if (!access.allowed) {
        return;
      }

      const scanSignals = normalizeScanSignals(profile.scans);
      const reflectionInput = {
        entry: payload.entry.trim(),
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
      };

      const entry = reflectionInput.entry;
      const skipAi =
        parseBoolean(payload.skipAi) ||
        String(payload.source ?? "") === "scanner-checkin";
      const journalContext = await buildJournalRagContext({
        profileId: payload.profileId,
        queryText: entry,
        currentText: entry,
        limit: 5,
      });
      const aiReflectionResult = skipAi
        ? null
        : await analyzeDiary({
            profile,
            healthContext: profile.healthContext,
            entry,
            journalContext,
            moodTag: reflectionInput.moodTag,
            energyLevel: reflectionInput.energyLevel,
            stressLevel: reflectionInput.stressLevel,
            sleepHours: reflectionInput.sleepHours,
            waterIntakeMl: reflectionInput.waterIntakeMl,
            activityMinutes: reflectionInput.activityMinutes,
            scanSignals,
          });
      const aiReflection =
        aiReflectionResult?.reflection ?? buildDiaryReflection(reflectionInput);

      const diary = await prisma.diaryEntry.create({
        data: {
          profileId: payload.profileId,
          ...buildDiaryData({ payload, entry, aiReflection }),
        },
      });

      indexDiaryEntryChunks({
        profileId: payload.profileId,
        diaryEntryId: diary.id,
        entry,
      }).catch((error) =>
        console.error("diary.index.error", {
          profileId: payload.profileId,
          diaryEntryId: diary.id,
          message: error?.message ?? "Unknown diary index error",
        }),
      );
      runDiaryFollowups({
        profileId: payload.profileId,
        date: diary.createdAt,
      });

      res.status(201).json({ diary, aiReflectionResult, journalContext });
    }),
  );

  app.patch(
    "/diary/:entryId",
    authlessWriteLimiter,
    asyncHandler(async (req, res) => {
      const payload = req.body ?? {};
      const existing = await loadDiaryWithAccess(req, res, req.params.entryId);
      if (!existing) {
        return;
      }

      const entry = String(payload.entry ?? "").trim();
      if (!entry) {
        return res.status(400).json({ error: "entry is required" });
      }

      let aiReflectionResult = null;
      let journalContext = null;
      let aiReflection = existing.aiReflection;

      const clientReflection = String(payload.aiReflection ?? "").trim();
      if (clientReflection) {
        aiReflection = clientReflection;
      } else if (isBlankReflection(existing.aiReflection)) {
        const scanSignals = normalizeScanSignals(existing.profile.scans);
        const reflectionInput = {
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
        };
        const skipAi =
          parseBoolean(payload.skipAi) ||
          String(payload.source ?? "") === "scanner-checkin";
        journalContext = await buildJournalRagContext({
          profileId: existing.profileId,
          queryText: entry,
          currentText: entry,
          limit: 5,
        });
        aiReflectionResult = skipAi
          ? null
          : await analyzeDiary({
              profile: existing.profile,
              healthContext: existing.profile.healthContext,
              entry,
              journalContext,
              moodTag: reflectionInput.moodTag,
              energyLevel: reflectionInput.energyLevel,
              stressLevel: reflectionInput.stressLevel,
              sleepHours: reflectionInput.sleepHours,
              waterIntakeMl: reflectionInput.waterIntakeMl,
              activityMinutes: reflectionInput.activityMinutes,
              scanSignals,
            });
        aiReflection =
          aiReflectionResult?.reflection ??
          buildDiaryReflection(reflectionInput);
      }

      const diary = await prisma.diaryEntry.update({
        where: { id: existing.id },
        data: buildDiaryData({ payload, entry, aiReflection }),
      });

      runDiaryFollowups({
        profileId: diary.profileId,
        diaryEntryId: diary.id,
        entry,
        date: diary.createdAt,
      });

      res.json({ diary, aiReflectionResult, journalContext });
    }),
  );

  app.delete(
    "/diary/:entryId",
    authlessWriteLimiter,
    asyncHandler(async (req, res) => {
      const existing = await loadDiaryWithAccess(req, res, req.params.entryId);
      if (!existing) {
        return;
      }

      await prisma.diaryEntry.delete({ where: { id: existing.id } });
      runDiaryFollowups({
        profileId: existing.profileId,
        date: existing.createdAt,
      });

      res.json({ ok: true, deletedId: existing.id });
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
