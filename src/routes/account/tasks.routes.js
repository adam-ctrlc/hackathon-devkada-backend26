import { prisma } from "../../lib/prisma.js";
import { asyncHandler } from "../../utils/async-handler.js";
import { buildDashboardMetrics } from "../../services/wellness/analysis.service.js";
import { generateWellnessSuggestions } from "../../services/ai/ai.service.js";
import { taskRouteLimiter } from "../../middleware/security.middleware.js";
import { requireProfileAccess } from "../../services/profile/profile-access.service.js";

const requireTaskId = (value) => {
  const text = String(value ?? "").trim();
  if (!text) {
    throw new Error("taskId is required");
  }
  return text;
};

export const registerTaskRoutes = (app) => {
  app.get(
    "/tasks/:profileId",
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

      const tasks = await prisma.wellnessTask.findMany({
        where: { profileId: req.params.profileId },
        orderBy: { createdAt: "desc" },
      });

      res.json({ tasks });
    }),
  );

  app.post(
    "/tasks",
    taskRouteLimiter,
    asyncHandler(async (req, res) => {
      const payload = req.body ?? {};
      if (!payload.profileId) {
        return res.status(400).json({ error: "profileId is required" });
      }
      if (!String(payload.title ?? "").trim()) {
        return res.status(400).json({ error: "title is required" });
      }

      const task = await prisma.wellnessTask.create({
        data: {
          profileId: payload.profileId,
          title: String(payload.title).trim(),
          reason: String(payload.reason ?? "").trim() || null,
          action: String(payload.action ?? "").trim() || null,
          category: String(payload.category ?? "").trim() || null,
          priority: String(payload.priority ?? "Medium").trim(),
          status: String(payload.status ?? "suggested").trim(),
          source: "manual",
          dueDate: payload.dueDate ? new Date(payload.dueDate) : null,
        },
      });

      res.status(201).json({ task });
    }),
  );

  app.post(
    "/tasks/:profileId/generate",
    taskRouteLimiter,
    asyncHandler(async (req, res) => {
      const profileMeta = await prisma.profile.findUnique({
        where: { id: req.params.profileId },
        select: { id: true, role: true, parentProfileId: true },
      });

      if (!profileMeta) {
        return res.status(404).json({ error: "Profile not found" });
      }

      const access = await requireProfileAccess(req, res, profileMeta);
      if (!access.allowed) {
        return;
      }

      const profile = await prisma.profile.findUnique({
        where: { id: req.params.profileId },
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

      const metrics = buildDashboardMetrics({
        profile,
        scans: profile.scans,
        diaries: profile.diaryEntries,
      });

      const bundle = await generateWellnessSuggestions({
        profile,
        healthContext: profile.healthContext,
        metrics,
        scans: profile.scans,
        diaries: profile.diaryEntries,
        summaries: profile.dailySummaries,
      });

      await prisma.wellnessTask.deleteMany({
        where: {
          profileId: profile.id,
          source: "ai",
          status: "suggested",
        },
      });

      const created = await prisma.$transaction(
        bundle.suggestions.map((item) =>
          prisma.wellnessTask.create({
            data: {
              profileId: profile.id,
              title: item.title,
              reason: item.reason ?? null,
              action: item.action ?? null,
              category: item.category ?? null,
              priority: item.priority ?? "Medium",
              status: "suggested",
              source: "ai",
            },
          }),
        ),
      );

      res.status(201).json({
        headline: bundle.headline,
        calendarNote: bundle.calendarNote,
        tasks: created,
        profileSignals: bundle.profileSignals,
      });
    }),
  );

  app.patch(
    "/tasks/:taskId",
    taskRouteLimiter,
    asyncHandler(async (req, res) => {
      const taskId = requireTaskId(req.params.taskId);
      const payload = req.body ?? {};

      const task = await prisma.wellnessTask.update({
        where: { id: taskId },
        data: {
          title: payload.title?.trim(),
          reason: payload.reason?.trim(),
          action: payload.action?.trim(),
          category: payload.category?.trim(),
          priority: payload.priority?.trim(),
          status: payload.status?.trim(),
          dueDate: payload.dueDate ? new Date(payload.dueDate) : undefined,
        },
      });

      res.json({ task });
    }),
  );

  app.delete(
    "/tasks/:taskId",
    taskRouteLimiter,
    asyncHandler(async (req, res) => {
      const taskId = requireTaskId(req.params.taskId);
      await prisma.wellnessTask.delete({ where: { id: taskId } });
      res.status(204).end();
    }),
  );
};
