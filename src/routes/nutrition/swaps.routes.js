import { prisma } from "../../lib/prisma.js";
import { asyncHandler } from "../../utils/async-handler.js";
import { authlessWriteLimiter } from "../../middleware/security.middleware.js";
import { requireProfileAccess } from "../../services/profile/profile-access.service.js";

const allowedStatuses = new Set(["suggested", "accepted", "dismissed"]);

const loadProfileWithAccess = async (req, res, profileId) => {
  const profile = await prisma.profile.findUnique({
    where: { id: profileId },
    select: { id: true, role: true, parentProfileId: true },
  });

  if (!profile) {
    res.status(404).json({ error: "Profile not found" });
    return null;
  }

  const access = await requireProfileAccess(req, res, profile);
  if (!access.allowed) {
    return null;
  }

  return profile;
};

const normalizeJsonArray = (value) => (Array.isArray(value) ? value : []);

const buildSwapTaskData = (swap, acceptedAt = new Date()) => {
  const title = `Next time: ${swap.from} → ${swap.to}`;
  const action = String(
    swap.aiPayload?.action ??
      `Choose ${swap.to} next time instead of ${swap.from}.`,
  ).trim();

  return {
    profileId: swap.profileId,
    title,
    reason: String(swap.reason ?? "").trim() || null,
    action,
    category: "food-swap",
    priority:
      String(swap.supportLevel ?? "").toLowerCase() === "low"
        ? "High"
        : "Medium",
    status: "suggested",
    source: String(swap.source ?? "scanner-swap").trim() || "scanner-swap",
    aiPayload: {
      kind: "swap-follow-up",
      swapId: swap.id,
      from: swap.from,
      to: swap.to,
      supportLevel: swap.supportLevel ?? null,
      source: swap.source ?? "scanner-swap",
      recommendationMode: "next_time",
      acceptedAt: acceptedAt.toISOString(),
      scanContext: swap.aiPayload?.scanContext ?? {
        scanId: swap.aiPayload?.scanId ?? null,
        eatenAt: swap.aiPayload?.eatenAt ?? null,
        mealPeriod: swap.aiPayload?.mealPeriod ?? null,
      },
    },
  };
};

const upsertSwapTask = async (swap) => {
  const taskData = buildSwapTaskData(swap);
  const existing = await prisma.wellnessTask.findFirst({
    where: {
      profileId: taskData.profileId,
      source: taskData.source,
      title: taskData.title,
    },
  });

  if (existing) {
    return prisma.wellnessTask.update({
      where: { id: existing.id },
      data: {
        ...taskData,
        status: existing.status,
      },
    });
  }

  return prisma.wellnessTask.create({ data: taskData });
};

const buildSwapData = ({ profileId, swap, profileSnapshot = null }) => ({
  profileId,
  from: String(swap.from ?? "Less supportive option").trim(),
  to: String(swap.to ?? swap.name ?? "").trim(),
  reason: String(swap.reason ?? swap.why ?? "").trim(),
  supportLevel: swap.supportLevel ? String(swap.supportLevel).trim() : null,
  status: allowedStatuses.has(String(swap.status)) ? swap.status : "suggested",
  source: String(swap.source ?? "gemini-live").trim() || "gemini-live",
  nutrition: swap.nutrition ?? null,
  delta: normalizeJsonArray(swap.delta),
  groceries: normalizeJsonArray(swap.groceries ?? swap.groceryList),
  aiPayload: swap.aiPayload ?? swap,
  profileSnapshot,
});

export const registerSwapRoutes = (app) => {
  app.get(
    "/swaps/:profileId",
    asyncHandler(async (req, res) => {
      const profile = await loadProfileWithAccess(
        req,
        res,
        req.params.profileId,
      );
      if (!profile) {
        return;
      }

      const swaps = await prisma.swapSuggestion.findMany({
        where: { profileId: profile.id },
        orderBy: { createdAt: "desc" },
      });

      res.json({ swaps });
    }),
  );

  app.post(
    "/swaps",
    authlessWriteLimiter,
    asyncHandler(async (req, res) => {
      const payload = req.body ?? {};

      if (!payload.profileId) {
        return res.status(400).json({ error: "profileId is required" });
      }

      if (!Array.isArray(payload.swaps)) {
        return res.status(400).json({ error: "swaps array is required" });
      }

      const profile = await loadProfileWithAccess(req, res, payload.profileId);
      if (!profile) {
        return;
      }

      const rows = payload.swaps
        .map((swap) =>
          buildSwapData({
            profileId: profile.id,
            swap,
            profileSnapshot: payload.profileSnapshot ?? null,
          }),
        )
        .filter((swap) => swap.to && swap.reason);

      if (!rows.length) {
        return res
          .status(400)
          .json({ error: "at least one valid swap is required" });
      }

      await prisma.$transaction([
        prisma.swapSuggestion.deleteMany({ where: { profileId: profile.id } }),
        prisma.swapSuggestion.createMany({ data: rows }),
      ]);

      const swaps = await prisma.swapSuggestion.findMany({
        where: { profileId: profile.id },
        orderBy: { createdAt: "desc" },
      });

      res.status(201).json({ swaps });
    }),
  );

  app.post(
    "/swaps/from-scan",
    authlessWriteLimiter,
    asyncHandler(async (req, res) => {
      const payload = req.body ?? {};

      if (!payload.profileId) {
        return res.status(400).json({ error: "profileId is required" });
      }

      if (!Array.isArray(payload.swaps)) {
        return res.status(400).json({ error: "swaps array is required" });
      }

      const profile = await loadProfileWithAccess(req, res, payload.profileId);
      if (!profile) {
        return;
      }

      const rows = payload.swaps
        .map((swap) =>
          buildSwapData({
            profileId: profile.id,
            swap: {
              ...swap,
              source: swap.source ?? "scanner-swap",
            },
            profileSnapshot: payload.profileSnapshot ?? null,
          }),
        )
        .filter((swap) => swap.to && swap.reason);

      if (!rows.length) {
        return res
          .status(400)
          .json({ error: "at least one valid swap is required" });
      }

      const swaps = [];
      for (const row of rows) {
        const existing = await prisma.swapSuggestion.findFirst({
          where: {
            profileId: profile.id,
            from: row.from,
            to: row.to,
            source: row.source,
          },
          orderBy: { createdAt: "desc" },
        });

        if (existing) {
          const updatedSwap = await prisma.swapSuggestion.update({
            where: { id: existing.id },
            data: {
              ...row,
              status: row.status,
            },
          });
          swaps.push(updatedSwap);
          if (updatedSwap.status === "accepted") {
            await upsertSwapTask(updatedSwap);
          }
          continue;
        }

        const createdSwap = await prisma.swapSuggestion.create({ data: row });
        swaps.push(createdSwap);

        if (createdSwap.status === "accepted") {
          await upsertSwapTask(createdSwap);
        }
      }

      res.status(201).json({ swaps });
    }),
  );

  app.patch(
    "/swaps/:swapId",
    authlessWriteLimiter,
    asyncHandler(async (req, res) => {
      const existing = await prisma.swapSuggestion.findUnique({
        where: { id: req.params.swapId },
        include: {
          profile: {
            select: { id: true, role: true, parentProfileId: true },
          },
        },
      });

      if (!existing) {
        return res.status(404).json({ error: "Swap not found" });
      }

      const access = await requireProfileAccess(req, res, existing.profile);
      if (!access.allowed) {
        return;
      }

      const status = String(req.body?.status ?? "").trim();
      if (!allowedStatuses.has(status)) {
        return res.status(400).json({ error: "invalid swap status" });
      }

      const swap = await prisma.swapSuggestion.update({
        where: { id: existing.id },
        data: { status },
      });

      let task = null;
      if (status === "accepted") {
        task = await upsertSwapTask(swap);
      }

      res.json({ swap, task });
    }),
  );
};
