import { prisma } from "../../lib/prisma.js";
import { asyncHandler } from "../../utils/async-handler.js";
import { startOfDay } from "../../utils/date.js";
import { requireProfileAccess } from "../../services/profile/profile-access.service.js";
import {
  generateWorkoutLogOverview,
  generateWorkoutSuggestions,
} from "../../services/ai/ai.service.js";
import {
  buildWgerWorkoutSuggestions,
  listWgerEquipment,
  listWgerExercises,
  listWgerMuscles,
} from "../../services/fitness/wger.service.js";

const parseLimit = (value, fallback = 10, max = 50) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }
  return Math.min(max, Math.floor(parsed));
};

const parseOffset = (value) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? Math.floor(parsed) : 0;
};

const parseBoolean = (value) => {
  if (typeof value === "boolean") {
    return value;
  }

  const text = String(value ?? "")
    .trim()
    .toLowerCase();
  return ["1", "true", "yes", "y", "on"].includes(text);
};

const serializeWorkoutSuggestion = (item, cached = false) => ({
  source: item.source,
  headline: item.headline ?? "Workout ideas",
  sessionNote:
    item.sessionNote ?? "Pick one session that matches your energy today.",
  workouts: item.workouts ?? [],
  calendarNote: item.calendarNote ?? "Try one session this week.",
  profileSignals: item.profileSignals ?? [],
  cached,
  date: item.date,
  updatedAt: item.updatedAt,
});

const getDailyWorkoutSuggestion = async ({
  profile,
  maxMinutes,
  equipment,
  source,
}) => {
  const date = startOfDay(new Date());
  const cached = await prisma.workoutSuggestionCache.findUnique({
    where: { profileId_date: { profileId: profile.id, date } },
  });

  if (cached) {
    return serializeWorkoutSuggestion(cached, true);
  }

  const generated = await generateWorkoutSuggestions({
    profile,
    healthContext: profile.healthContext,
    maxMinutes,
    equipment,
    source,
  });

  const saved = await prisma.workoutSuggestionCache.upsert({
    where: { profileId_date: { profileId: profile.id, date } },
    update: {
      source: generated.source ?? "gemini",
      headline: generated.headline ?? null,
      sessionNote: generated.sessionNote ?? null,
      workouts: generated.workouts ?? [],
      calendarNote: generated.calendarNote ?? null,
      profileSignals: generated.profileSignals ?? [],
    },
    create: {
      profileId: profile.id,
      date,
      source: generated.source ?? "gemini",
      headline: generated.headline ?? null,
      sessionNote: generated.sessionNote ?? null,
      workouts: generated.workouts ?? [],
      calendarNote: generated.calendarNote ?? null,
      profileSignals: generated.profileSignals ?? [],
    },
  });

  return serializeWorkoutSuggestion(saved, false);
};

export const registerFitnessRoutes = (app) => {
  app.get(
    "/fitness/exercises",
    asyncHandler(async (req, res) => {
      const exercises = await listWgerExercises({
        query: req.query.q ?? req.query.query ?? "",
        limit: parseLimit(req.query.limit, 10, 50),
        offset: parseOffset(req.query.offset),
        category: req.query.category ?? null,
        muscle: req.query.muscle ?? null,
        equipment: req.query.equipment ?? null,
      });

      res.json(exercises);
    }),
  );

  app.get(
    "/fitness/muscles",
    asyncHandler(async (req, res) => {
      const muscles = await listWgerMuscles({
        limit: parseLimit(req.query.limit, 100, 100),
        offset: parseOffset(req.query.offset),
      });

      res.json(muscles);
    }),
  );

  app.get(
    "/fitness/equipment",
    asyncHandler(async (req, res) => {
      const equipment = await listWgerEquipment({
        limit: parseLimit(req.query.limit, 100, 100),
        offset: parseOffset(req.query.offset),
      });

      res.json(equipment);
    }),
  );

  app.get(
    "/fitness/workout/:profileId",
    asyncHandler(async (req, res) => {
      const profile = await prisma.profile.findUnique({
        where: { id: req.params.profileId },
        include: { healthContext: true },
      });

      if (!profile) {
        return res.status(404).json({ error: "Profile not found" });
      }

      const access = await requireProfileAccess(req, res, profile);
      if (!access.allowed) {
        return;
      }

      const workout = await buildWgerWorkoutSuggestions({
        profile,
        query: req.query.q ?? req.query.query ?? "",
        limit: parseLimit(req.query.limit, 5, 10),
      });

      res.json(workout);
    }),
  );

  app.post(
    "/fitness/workout/:profileId/suggest",
    asyncHandler(async (req, res) => {
      const profile = await prisma.profile.findUnique({
        where: { id: req.params.profileId },
        include: { healthContext: true },
      });

      if (!profile) {
        return res.status(404).json({ error: "Profile not found" });
      }

      const access = await requireProfileAccess(req, res, profile);
      if (!access.allowed) {
        return;
      }

      const wantsGemini = parseBoolean(
        req.body?.useGemini ?? req.query.useGemini,
      );

      const equipment = Array.isArray(req.body?.equipment)
        ? req.body.equipment
        : Array.isArray(req.query?.equipment)
          ? req.query.equipment
          : [];

      const maxMinutes = Number(
        req.body?.maxMinutes ?? req.query.maxMinutes ?? 45,
      );
      const suggestion = wantsGemini
        ? await getDailyWorkoutSuggestion({
            profile,
            maxMinutes,
            equipment,
            source: String(req.body?.source ?? req.query.source ?? "gemini"),
          })
        : await buildWgerWorkoutSuggestions({
            profile,
            query: String(
              req.body?.query ?? req.query.q ?? req.query.query ?? "",
            ),
            limit: parseLimit(req.body?.limit ?? req.query.limit, 5, 10),
          });

      res.json(suggestion);
    }),
  );

  app.get(
    "/fitness/workouts/:profileId",
    asyncHandler(async (req, res) => {
      const profile = await prisma.profile.findUnique({
        where: { id: req.params.profileId },
        select: { id: true, role: true, parentProfileId: true },
      });

      if (!profile) {
        return res.status(404).json({ error: "Profile not found" });
      }

      const access = await requireProfileAccess(req, res, profile);
      if (!access.allowed) {
        return;
      }

      const workoutLogs = await prisma.workoutLog.findMany({
        where: { profileId: req.params.profileId },
        orderBy: { createdAt: "desc" },
      });

      res.json({ workoutLogs });
    }),
  );

  app.post(
    "/fitness/workouts",
    asyncHandler(async (req, res) => {
      const payload = req.body ?? {};
      const workoutName = String(
        payload.workoutName ?? payload.name ?? payload.title ?? "",
      ).trim();

      if (!payload.profileId) {
        return res.status(400).json({ error: "profileId is required" });
      }

      if (!workoutName) {
        return res.status(400).json({ error: "workoutName is required" });
      }

      const profile = await prisma.profile.findUnique({
        where: { id: payload.profileId },
        include: { healthContext: true },
      });

      if (!profile) {
        return res.status(404).json({ error: "Profile not found" });
      }

      const access = await requireProfileAccess(req, res, profile);
      if (!access.allowed) {
        return;
      }

      const durationMinutes = Number(payload.durationMinutes ?? 0);
      const durationHours = Number(
        payload.durationHours ??
          payload.hours ??
          payload.durationHoursText ??
          0,
      );
      const resolvedMinutes =
        Number.isFinite(durationMinutes) && durationMinutes > 0
          ? Math.round(durationMinutes)
          : Number.isFinite(durationHours) && durationHours > 0
            ? Math.round(durationHours * 60)
            : null;

      if (!resolvedMinutes) {
        return res
          .status(400)
          .json({ error: "durationMinutes or durationHours is required" });
      }

      const workoutDraft = {
        title: workoutName,
        workoutType: String(payload.workoutType ?? "").trim() || null,
        source: String(payload.source ?? "manual").trim() || "manual",
        durationMinutes: resolvedMinutes,
        durationHours:
          Number.isFinite(durationHours) && durationHours > 0
            ? durationHours
            : resolvedMinutes / 60,
        caloriesBurned: Number.isFinite(Number(payload.caloriesBurned))
          ? Number(payload.caloriesBurned)
          : null,
        distanceKm: Number.isFinite(Number(payload.distanceKm))
          ? Number(payload.distanceKm)
          : null,
        intensity: String(payload.intensity ?? "").trim() || null,
        notes: payload.notes ?? null,
      };
      const aiAnalysis =
        payload.aiAnalysis ??
        (await generateWorkoutLogOverview({
          profile,
          healthContext: profile.healthContext,
          workout: workoutDraft,
        }));

      const workoutLog = await prisma.workoutLog.create({
        data: {
          profileId: payload.profileId,
          ...workoutDraft,
          aiAnalysis,
        },
      });

      res.status(201).json({ workoutLog });
    }),
  );
};
