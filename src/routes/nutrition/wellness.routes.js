import { prisma } from "../../lib/prisma.js";
import { asyncHandler } from "../../utils/async-handler.js";
import { authlessWriteLimiter } from "../../middleware/security.middleware.js";
import { refreshDailySummary } from "../../services/wellness/daily-summary.service.js";
import { buildDashboardMetrics } from "../../services/wellness/analysis.service.js";
import { buildEngagementMetrics } from "../../services/wellness/engagement.service.js";
import {
  getWaterIntakeRange,
  buildWaterStreaks,
  recordWaterLog,
  sumWaterLogs,
} from "../../services/wellness/water.service.js";
import {
  getSleepRange,
  recordSleepLog,
  sumSleepHours,
} from "../../services/wellness/sleep.service.js";
import { generateBudgetSuggestions } from "../../services/ai/ai.service.js";
import {
  buildBudgetMealSuggestions,
  buildGroceryList,
  buildWellnessReminders,
  getSafetySection,
} from "../../services/nutrition/meal-knowledge.service.js";
import {
  buildBudgetContext,
  sumEstimatedSpend,
} from "../../services/nutrition/budget.service.js";
import { requireProfileAccess } from "../../services/profile/profile-access.service.js";

const parseMaxPhp = (value, fallback = 100) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

const parseCurrency = (value, fallback = "PHP") => {
  const text = String(value ?? "")
    .trim()
    .toUpperCase();
  return text.length === 3 ? text : fallback;
};

const parseBoolean = (value) =>
  ["1", "true", "yes", "on"].includes(
    String(value ?? "")
      .trim()
      .toLowerCase(),
  );

const resolveBudgetDate = (payload = {}) => {
  const raw = payload.spentAt ?? payload.plannedFor ?? payload.date;
  const date = raw ? new Date(raw) : new Date();
  return Number.isNaN(date.getTime()) ? new Date() : date;
};

const normalizeBudgetItems = (items) => {
  if (Array.isArray(items)) {
    return items
      .map((item) => {
        if (item && typeof item === "object") {
          const name = String(item.name ?? item.title ?? "").trim();
          const amount = Number(item.amount);
          if (!name && !Number.isFinite(amount)) return null;
          return {
            name,
            amount: Number.isFinite(amount) ? amount : null,
          };
        }

        const name = String(item).trim();
        return name ? { name, amount: null } : null;
      })
      .filter(Boolean);
  }

  return String(items ?? "")
    .split(/\s*(?:,|\n)\s*/)
    .map((item) => item.trim())
    .filter(Boolean)
    .map((name) => ({ name, amount: null }));
};

const resolveWaterAmount = (payload) => {
  if (payload.amountMl !== undefined) {
    return Number(payload.amountMl);
  }

  if (payload.glasses !== undefined) {
    const glassSizeMl = Number(payload.glassSizeMl ?? 250);
    return (
      Number(payload.glasses) *
      (Number.isFinite(glassSizeMl) ? glassSizeMl : 250)
    );
  }

  return NaN;
};

const optionalPositiveInt = (value, fallback = null) => {
  if (value === undefined) {
    return fallback;
  }

  const parsed = Math.round(Number(value));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

const resolveWaterTiming = (payload = {}) => {
  const raw = payload.drankAt ?? payload.createdAt;
  const drankAt = raw ? new Date(raw) : new Date();
  const safeDrankAt = Number.isNaN(drankAt.getTime()) ? new Date() : drankAt;
  const hour = safeDrankAt.getHours();
  const inferred =
    hour < 5
      ? "midnight"
      : hour < 11
        ? "morning"
        : hour < 15
          ? "afternoon"
          : hour < 19
            ? "evening"
            : "night";

  return {
    drankAt: safeDrankAt,
    waterPeriod: inferred,
  };
};

const resolveSleepTiming = (payload = {}) => {
  const raw = payload.sleptAt ?? payload.createdAt;
  const sleptAt = raw ? new Date(raw) : new Date();
  const safeSleptAt = Number.isNaN(sleptAt.getTime()) ? new Date() : sleptAt;
  const hour = safeSleptAt.getHours();
  const inferred =
    hour < 4
      ? "midnight"
      : hour < 10
        ? "morning"
        : hour < 15
          ? "afternoon"
          : hour < 20
            ? "evening"
            : "night";

  return {
    sleptAt: safeSleptAt,
    sleepPeriod: inferred,
  };
};

export const registerWellnessRoutes = (app) => {
  app.get(
    "/safety",
    asyncHandler(async (req, res) => {
      res.json(getSafetySection());
    }),
  );

  app.post(
    "/water",
    authlessWriteLimiter,
    asyncHandler(async (req, res) => {
      const payload = req.body ?? {};

      if (!payload.profileId) {
        return res.status(400).json({ error: "profileId is required" });
      }

      const amountMl = resolveWaterAmount(payload);
      if (!Number.isFinite(amountMl) || amountMl <= 0) {
        return res
          .status(400)
          .json({ error: "amountMl or glasses is required" });
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

      const timing = resolveWaterTiming(payload);
      const log = await recordWaterLog({
        profileId: payload.profileId,
        amountMl,
        glassCount: optionalPositiveInt(payload.glasses),
        glassSizeMl: optionalPositiveInt(payload.glassSizeMl),
        waterPeriod: timing.waterPeriod,
        source: String(payload.source ?? "manual").trim() || "manual",
        note: payload.note?.trim() ?? null,
        drankAt: timing.drankAt,
        createdAt: timing.drankAt,
      });

      await refreshDailySummary(payload.profileId, log.createdAt, {
        skipAi: true,
      });

      const range = await getWaterIntakeRange({
        profileId: payload.profileId,
        days: 7,
      });
      const metrics = buildDashboardMetrics({
        profile,
        scans: [],
        diaries: [],
        waterLogs: [log],
      });

      res.status(201).json({
        waterLog: log,
        totalMlToday: range.series[range.series.length - 1]?.amountMl ?? 0,
        streaks: buildWaterStreaks({
          waterSeries: range.series,
          targetMl: metrics.waterTargetMl ?? 1500,
        }),
      });
    }),
  );

  app.patch(
    "/water-logs/:logId",
    authlessWriteLimiter,
    asyncHandler(async (req, res) => {
      const existing = await prisma.waterLog.findUnique({
        where: { id: req.params.logId },
        include: {
          profile: {
            select: { id: true, role: true, parentProfileId: true },
          },
        },
      });

      if (!existing) {
        return res.status(404).json({ error: "Water log not found" });
      }

      const access = await requireProfileAccess(req, res, existing.profile);
      if (!access.allowed) {
        return;
      }

      const payload = req.body ?? {};
      const amountMl =
        payload.amountMl !== undefined || payload.glasses !== undefined
          ? resolveWaterAmount(payload)
          : existing.amountMl;

      if (!Number.isFinite(amountMl) || amountMl <= 0) {
        return res
          .status(400)
          .json({ error: "valid water amount is required" });
      }

      const timing = resolveWaterTiming({
        drankAt: payload.drankAt ?? existing.drankAt ?? existing.createdAt,
      });
      const waterLog = await prisma.waterLog.update({
        where: { id: req.params.logId },
        data: {
          amountMl,
          glassCount: optionalPositiveInt(payload.glasses, existing.glassCount),
          glassSizeMl: optionalPositiveInt(
            payload.glassSizeMl,
            existing.glassSizeMl,
          ),
          waterPeriod: timing.waterPeriod,
          drankAt: timing.drankAt,
          note:
            payload.note === undefined
              ? existing.note
              : String(payload.note ?? "").trim() || null,
        },
      });

      await refreshDailySummary(
        existing.profileId,
        waterLog.drankAt ?? waterLog.createdAt,
        {
          skipAi: true,
        },
      );
      res.json({ waterLog });
    }),
  );

  app.delete(
    "/water-logs/:logId",
    authlessWriteLimiter,
    asyncHandler(async (req, res) => {
      const existing = await prisma.waterLog.findUnique({
        where: { id: req.params.logId },
        include: {
          profile: {
            select: { id: true, role: true, parentProfileId: true },
          },
        },
      });

      if (!existing) {
        return res.status(404).json({ error: "Water log not found" });
      }

      const access = await requireProfileAccess(req, res, existing.profile);
      if (!access.allowed) {
        return;
      }

      await prisma.waterLog.delete({ where: { id: req.params.logId } });
      await refreshDailySummary(
        existing.profileId,
        existing.drankAt ?? existing.createdAt,
        {
          skipAi: true,
        },
      );
      res.status(204).end();
    }),
  );

  app.get(
    "/water/:profileId",
    asyncHandler(async (req, res) => {
      const days = Math.max(1, Math.min(30, Number(req.query.days ?? 7) || 7));
      const range = await getWaterIntakeRange({
        profileId: req.params.profileId,
        days,
      });
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

      const metrics = buildDashboardMetrics({
        profile,
        scans: [],
        diaries: [],
        waterLogs: range.logs,
      });

      res.json({
        water: {
          totalMl: range.totalMl,
          series: range.series,
          logs: range.logs,
        },
        targetMl: metrics.waterTargetMl,
        streaks: buildWaterStreaks({
          waterSeries: range.series,
          targetMl: metrics.waterTargetMl,
        }),
      });
    }),
  );

  app.post(
    "/sleep",
    authlessWriteLimiter,
    asyncHandler(async (req, res) => {
      const payload = req.body ?? {};
      if (!payload.profileId) {
        return res.status(400).json({ error: "profileId is required" });
      }

      const hours = Number(payload.hours);
      if (!Number.isFinite(hours) || hours <= 0 || hours > 24) {
        return res
          .status(400)
          .json({ error: "hours must be between 0 and 24" });
      }

      const profile = await prisma.profile.findUnique({
        where: { id: payload.profileId },
        include: { healthContext: true },
      });
      if (!profile) {
        return res.status(404).json({ error: "Profile not found" });
      }

      const access = await requireProfileAccess(req, res, profile);
      if (!access.allowed) return;

      const timing = resolveSleepTiming(payload);
      const log = await recordSleepLog({
        profileId: payload.profileId,
        hours,
        sleepPeriod: timing.sleepPeriod,
        source: String(payload.source ?? "manual").trim() || "manual",
        note: payload.note?.trim() ?? null,
        sleptAt: timing.sleptAt,
        createdAt: timing.sleptAt,
      });

      await refreshDailySummary(
        payload.profileId,
        log.sleptAt ?? log.createdAt,
        {
          skipAi: true,
        },
      );

      res.status(201).json({ sleepLog: log });
    }),
  );

  app.patch(
    "/sleep-logs/:logId",
    authlessWriteLimiter,
    asyncHandler(async (req, res) => {
      const existing = await prisma.sleepLog.findUnique({
        where: { id: req.params.logId },
        include: {
          profile: { select: { id: true, role: true, parentProfileId: true } },
        },
      });
      if (!existing) {
        return res.status(404).json({ error: "Sleep log not found" });
      }

      const access = await requireProfileAccess(req, res, existing.profile);
      if (!access.allowed) return;

      const payload = req.body ?? {};
      const hours =
        payload.hours === undefined
          ? Number(existing.hours)
          : Number(payload.hours);
      if (!Number.isFinite(hours) || hours <= 0 || hours > 24) {
        return res
          .status(400)
          .json({ error: "hours must be between 0 and 24" });
      }

      const timing = resolveSleepTiming({
        sleptAt: payload.sleptAt ?? existing.sleptAt ?? existing.createdAt,
      });
      const sleepLog = await prisma.sleepLog.update({
        where: { id: req.params.logId },
        data: {
          hours,
          sleepPeriod: timing.sleepPeriod,
          sleptAt: timing.sleptAt,
          note:
            payload.note === undefined
              ? existing.note
              : String(payload.note ?? "").trim() || null,
        },
      });

      await refreshDailySummary(
        existing.profileId,
        sleepLog.sleptAt ?? sleepLog.createdAt,
        { skipAi: true },
      );

      res.json({ sleepLog });
    }),
  );

  app.delete(
    "/sleep-logs/:logId",
    authlessWriteLimiter,
    asyncHandler(async (req, res) => {
      const existing = await prisma.sleepLog.findUnique({
        where: { id: req.params.logId },
        include: {
          profile: { select: { id: true, role: true, parentProfileId: true } },
        },
      });
      if (!existing) {
        return res.status(404).json({ error: "Sleep log not found" });
      }

      const access = await requireProfileAccess(req, res, existing.profile);
      if (!access.allowed) return;

      await prisma.sleepLog.delete({ where: { id: req.params.logId } });
      await refreshDailySummary(
        existing.profileId,
        existing.sleptAt ?? existing.createdAt,
        { skipAi: true },
      );
      res.status(204).end();
    }),
  );

  app.get(
    "/sleep/:profileId",
    asyncHandler(async (req, res) => {
      const days = Math.max(1, Math.min(30, Number(req.query.days ?? 7) || 7));
      const autofill = ["1", "true", "yes", "on"].includes(
        String(req.query.autofill ?? "")
          .trim()
          .toLowerCase(),
      );
      const defaultHours = Number(req.query.defaultHours ?? 8);
      const safeDefaultHours =
        Number.isFinite(defaultHours) && defaultHours > 0 && defaultHours <= 24
          ? defaultHours
          : 8;

      const profile = await prisma.profile.findUnique({
        where: { id: req.params.profileId },
        include: { healthContext: true },
      });
      if (!profile) {
        return res.status(404).json({ error: "Profile not found" });
      }

      const access = await requireProfileAccess(req, res, profile);
      if (!access.allowed) return;

      if (autofill) {
        const now = new Date();
        const start = new Date(now);
        start.setHours(0, 0, 0, 0);
        const end = new Date(now);
        end.setHours(23, 59, 59, 999);
        const todayLog = await prisma.sleepLog.findFirst({
          where: {
            profileId: req.params.profileId,
            OR: [
              { sleptAt: { gte: start, lte: end } },
              { sleptAt: null, createdAt: { gte: start, lte: end } },
            ],
          },
        });
        if (!todayLog) {
          await recordSleepLog({
            profileId: req.params.profileId,
            hours: safeDefaultHours,
            sleepPeriod: "morning",
            source: "auto-default",
            note: "Auto default sleep log",
            sleptAt: now,
            createdAt: now,
          });
          await refreshDailySummary(req.params.profileId, now, {
            skipAi: true,
          });
        }
      }

      const range = await getSleepRange({
        profileId: req.params.profileId,
        days,
      });
      const avgHours =
        range.series.length > 0
          ? Number((sumSleepHours(range.logs) / range.series.length).toFixed(2))
          : 0;

      res.json({
        sleep: {
          totalHours: range.totalHours,
          avgHours,
          series: range.series,
          logs: range.logs,
        },
      });
    }),
  );

  app.get(
    "/budget/:profileId",
    asyncHandler(async (req, res) => {
      const maxPhp = parseMaxPhp(req.query.maxPhp, 100);
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

      const currency = parseCurrency(
        req.query.currency,
        profile.budgetCurrency ?? profile.incomeCurrency ?? "PHP",
      );
      if (parseBoolean(req.query.useGemini)) {
        const budget = await generateBudgetSuggestions({
          profile,
          healthContext: profile.healthContext,
          maxPhp,
          currency,
        });

        return res.json(budget);
      }

      const localMeals = buildBudgetMealSuggestions({
        profile,
        maxPhp,
        currency,
      });

      res.json({
        source: "local",
        headline: "Budget suggestions",
        budgetNote: `Local meal ideas under ${currency} ${maxPhp}.`,
        meals: localMeals,
        localMeals,
        groceryList: buildGroceryList({ budgetSuggestions: localMeals }),
        budgetContext: buildBudgetContext({
          profile,
          amountSpent: 0,
          fallbackDailyBudget: maxPhp,
          fallbackCurrency: currency,
        }),
      });
    }),
  );

  app.get(
    "/budget-logs/:profileId",
    asyncHandler(async (req, res) => {
      const profile = await prisma.profile.findUnique({
        where: { id: req.params.profileId },
        select: {
          id: true,
          role: true,
          parentProfileId: true,
          budgetAmount: true,
          budgetCurrency: true,
          budgetFrequency: true,
        },
      });

      if (!profile) {
        return res.status(404).json({ error: "Profile not found" });
      }

      const access = await requireProfileAccess(req, res, profile);
      if (!access.allowed) {
        return;
      }

      const logs = await prisma.foodBudgetLog.findMany({
        where: { profileId: req.params.profileId },
        orderBy: [
          { spentAt: "desc" },
          { plannedFor: "desc" },
          { createdAt: "desc" },
        ],
        take: Math.max(1, Math.min(120, Number(req.query.limit ?? 60) || 60)),
      });
      const spentLogs = logs.filter((log) => log.entryType === "spent");
      const plannedLogs = logs.filter((log) => log.entryType !== "spent");
      const totalSpent = spentLogs.reduce((sum, log) => sum + log.amount, 0);
      const totalPlanned = plannedLogs.reduce(
        (sum, log) => sum + log.amount,
        0,
      );
      const budgetAmount = Number(profile.budgetAmount ?? 0);

      res.json({
        logs,
        summary: {
          budgetAmount,
          budgetCurrency: profile.budgetCurrency ?? "PHP",
          budgetFrequency: profile.budgetFrequency ?? "monthly",
          totalSpent,
          totalPlanned,
          remaining: budgetAmount > 0 ? budgetAmount - totalSpent : null,
          overBudget: budgetAmount > 0 && totalSpent > budgetAmount,
        },
      });
    }),
  );

  app.post(
    "/budget-logs",
    authlessWriteLimiter,
    asyncHandler(async (req, res) => {
      const payload = req.body ?? {};
      const title = String(payload.title ?? "").trim();
      const amount = Number(payload.amount);
      const entryType = String(payload.entryType ?? "planned").trim();

      if (!payload.profileId) {
        return res.status(400).json({ error: "profileId is required" });
      }

      if (!title) {
        return res.status(400).json({ error: "title is required" });
      }

      if (!Number.isFinite(amount) || amount < 0) {
        return res.status(400).json({ error: "amount is required" });
      }

      const profile = await prisma.profile.findUnique({
        where: { id: payload.profileId },
        select: {
          id: true,
          role: true,
          parentProfileId: true,
          budgetCurrency: true,
        },
      });

      if (!profile) {
        return res.status(404).json({ error: "Profile not found" });
      }

      const access = await requireProfileAccess(req, res, profile);
      if (!access.allowed) {
        return;
      }

      const date = resolveBudgetDate(payload);
      const log = await prisma.foodBudgetLog.create({
        data: {
          profileId: payload.profileId,
          title,
          amount,
          currency: parseCurrency(
            payload.currency,
            profile.budgetCurrency ?? "PHP",
          ),
          category: String(payload.category ?? "").trim() || null,
          entryType: entryType === "spent" ? "spent" : "planned",
          items: normalizeBudgetItems(payload.items),
          note: String(payload.note ?? "").trim() || null,
          plannedFor: entryType === "spent" ? null : date,
          spentAt: entryType === "spent" ? date : null,
        },
      });

      res.status(201).json({ budgetLog: log });
    }),
  );

  app.delete(
    "/budget-logs/:logId",
    authlessWriteLimiter,
    asyncHandler(async (req, res) => {
      const log = await prisma.foodBudgetLog.findUnique({
        where: { id: req.params.logId },
        include: {
          profile: { select: { id: true, role: true, parentProfileId: true } },
        },
      });

      if (!log) {
        return res.status(404).json({ error: "Budget log not found" });
      }

      const access = await requireProfileAccess(req, res, log.profile);
      if (!access.allowed) {
        return;
      }

      await prisma.foodBudgetLog.delete({ where: { id: req.params.logId } });
      res.status(204).end();
    }),
  );

  app.get(
    "/grocery-list/:profileId",
    asyncHandler(async (req, res) => {
      const profile = await prisma.profile.findUnique({
        where: { id: req.params.profileId },
        include: {
          healthContext: true,
          scans: { orderBy: { createdAt: "desc" }, take: 10 },
          mealLogs: { orderBy: { createdAt: "desc" }, take: 10 },
        },
      });

      if (!profile) {
        return res.status(404).json({ error: "Profile not found" });
      }

      const access = await requireProfileAccess(req, res, profile);
      if (!access.allowed) {
        return;
      }

      const currency = parseCurrency(
        req.query.currency,
        profile.budgetCurrency ?? profile.incomeCurrency ?? "PHP",
      );
      const budget = await generateBudgetSuggestions({
        profile,
        healthContext: profile.healthContext,
        maxPhp: parseMaxPhp(req.query.maxPhp, 100),
        currency,
      });
      const budgetContext = buildBudgetContext({
        profile,
        amountSpent: sumEstimatedSpend({
          logs: [...profile.scans, ...profile.mealLogs],
          currency: profile.budgetCurrency ?? profile.incomeCurrency,
        }),
        fallbackDailyBudget: parseMaxPhp(req.query.maxPhp, 100),
        fallbackCurrency:
          profile.budgetCurrency ?? profile.incomeCurrency ?? "PHP",
      });

      const groceryList = buildGroceryList({
        meals: [
          ...profile.scans.map((scan) => ({
            groceryList: Array.isArray(scan.aiAnalysis?.groceryList)
              ? scan.aiAnalysis.groceryList
              : [],
            betterAlternatives: Array.isArray(scan.betterAlternatives)
              ? scan.betterAlternatives
              : [],
          })),
          ...profile.mealLogs.map((meal) => ({
            groceryList: Array.isArray(meal.aiAnalysis?.groceryList)
              ? meal.aiAnalysis.groceryList
              : [],
            betterAlternatives: Array.isArray(meal.betterAlternatives)
              ? meal.betterAlternatives
              : [],
          })),
        ],
        budgetSuggestions: budget.localMeals ?? budget.meals ?? [],
      });

      res.json({
        groceryList,
        budgetMeals: budget.meals ?? budget.localMeals ?? [],
        budgetContext,
      });
    }),
  );

  app.get(
    "/rewards/:profileId",
    asyncHandler(async (req, res) => {
      const [profile, scans, mealLogs, waterLogs, diaries] = await Promise.all([
        prisma.profile.findUnique({
          where: { id: req.params.profileId },
          include: { healthContext: true },
        }),
        prisma.foodScan.findMany({
          where: { profileId: req.params.profileId },
          orderBy: { createdAt: "desc" },
          take: 14,
        }),
        prisma.mealLog.findMany({
          where: { profileId: req.params.profileId },
          orderBy: { createdAt: "desc" },
          take: 14,
        }),
        prisma.waterLog.findMany({
          where: { profileId: req.params.profileId },
          orderBy: { createdAt: "desc" },
          take: 14,
        }),
        prisma.diaryEntry.findMany({
          where: { profileId: req.params.profileId },
          orderBy: { createdAt: "desc" },
          take: 14,
        }),
      ]);

      if (!profile) {
        return res.status(404).json({ error: "Profile not found" });
      }

      const access = await requireProfileAccess(req, res, profile);
      if (!access.allowed) {
        return;
      }

      const engagement = buildEngagementMetrics({
        scans,
        mealLogs,
        waterLogs,
        diaries,
      });

      res.json({
        rewards: engagement.rewards,
        streaks: engagement.streaks,
        communityMode: {
          title: "Family or caregiver support",
          description:
            "Family members can help review meal ideas, grocery lists, and recovery reminders without public sharing.",
          useCases: [
            "Parent tracks child-friendly meals.",
            "Caregiver helps with surgery recovery meals.",
            "Family reviews grocery suggestions together.",
          ],
        },
      });
    }),
  );

  app.get(
    "/wellness/:profileId",
    asyncHandler(async (req, res) => {
      const maxPhp = parseMaxPhp(req.query.maxPhp, 100);
      const [profile, scans, mealLogs, diaries, waterLogs, summaries] =
        await Promise.all([
          prisma.profile.findUnique({
            where: { id: req.params.profileId },
            include: { healthContext: true },
          }),
          prisma.foodScan.findMany({
            where: { profileId: req.params.profileId },
            orderBy: { createdAt: "desc" },
            take: 10,
          }),
          prisma.mealLog.findMany({
            where: { profileId: req.params.profileId },
            orderBy: { createdAt: "desc" },
            take: 10,
          }),
          prisma.diaryEntry.findMany({
            where: { profileId: req.params.profileId },
            orderBy: { createdAt: "desc" },
            take: 10,
          }),
          prisma.waterLog.findMany({
            where: { profileId: req.params.profileId },
            orderBy: { createdAt: "desc" },
            take: 20,
          }),
          prisma.dailySummary.findMany({
            where: { profileId: req.params.profileId },
            orderBy: { date: "desc" },
            take: 7,
          }),
        ]);

      if (!profile) {
        return res.status(404).json({ error: "Profile not found" });
      }

      const access = await requireProfileAccess(req, res, profile);
      if (!access.allowed) {
        return;
      }

      const currency = parseCurrency(
        req.query.currency,
        profile.budgetCurrency ?? profile.incomeCurrency ?? "PHP",
      );
      const dashboardMetrics = buildDashboardMetrics({
        profile,
        scans: [...scans, ...mealLogs],
        diaries,
        waterLogs,
      });

      const budget = await generateBudgetSuggestions({
        profile,
        healthContext: profile.healthContext,
        maxPhp,
        currency,
      });
      const budgetContext = buildBudgetContext({
        profile,
        amountSpent: sumEstimatedSpend({
          logs: [...scans, ...mealLogs],
          currency: profile.budgetCurrency ?? profile.incomeCurrency,
        }),
        fallbackDailyBudget: maxPhp,
        fallbackCurrency:
          profile.budgetCurrency ?? profile.incomeCurrency ?? "PHP",
      });

      const latestMeal = mealLogs[0] ?? scans[0] ?? null;
      const latestNutrition = latestMeal?.aiAnalysis?.nutrition ?? {
        sodiumMg: latestMeal?.sodiumMg ?? 0,
        proteinGrams: latestMeal?.proteinGrams ?? 0,
      };

      const engagement = buildEngagementMetrics({
        scans,
        mealLogs,
        waterLogs,
        diaries,
      });

      const waterTotalMl =
        sumWaterLogs(waterLogs) +
        diaries.reduce((sum, diary) => sum + (diary.waterIntakeMl ?? 0), 0);

      res.json({
        safety: getSafetySection(),
        reminders: buildWellnessReminders({
          profile,
          healthContext: profile.healthContext,
          nutrition: latestNutrition,
          waterTargetMl: dashboardMetrics.waterTargetMl,
          waterTotalMl,
          budgetContext,
        }),
        budget,
        budgetContext,
        groceryList: buildGroceryList({
          meals: [
            ...scans.map((scan) => ({
              groceryList: Array.isArray(scan.aiAnalysis?.groceryList)
                ? scan.aiAnalysis.groceryList
                : [],
              betterAlternatives: Array.isArray(scan.betterAlternatives)
                ? scan.betterAlternatives
                : [],
            })),
            ...mealLogs.map((meal) => ({
              groceryList: Array.isArray(meal.aiAnalysis?.groceryList)
                ? meal.aiAnalysis.groceryList
                : [],
              betterAlternatives: Array.isArray(meal.betterAlternatives)
                ? meal.betterAlternatives
                : [],
            })),
          ],
          budgetSuggestions: budget.localMeals ?? budget.meals ?? [],
        }),
        streaks: engagement.streaks,
        rewards: engagement.rewards,
        water: {
          totalMl: waterTotalMl,
          targetMl: dashboardMetrics.waterTargetMl,
          progress: dashboardMetrics.waterTargetMl
            ? Math.round((waterTotalMl / dashboardMetrics.waterTargetMl) * 100)
            : 0,
        },
        summaries,
      });
    }),
  );
};
