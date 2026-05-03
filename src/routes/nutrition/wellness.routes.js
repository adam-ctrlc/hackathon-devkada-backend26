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
import { generateBudgetSuggestions } from "../../services/ai/ai.service.js";
import {
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

const resolveWaterAmount = (payload) => {
  if (payload.amountMl !== undefined) {
    return Number(payload.amountMl);
  }

  if (payload.glasses !== undefined) {
    return Number(payload.glasses) * 250;
  }

  return NaN;
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

      const log = await recordWaterLog({
        profileId: payload.profileId,
        amountMl,
        source: String(payload.source ?? "manual").trim() || "manual",
        note: payload.note?.trim() ?? null,
        createdAt: payload.createdAt ? new Date(payload.createdAt) : new Date(),
      });

      await refreshDailySummary(payload.profileId, log.createdAt);

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
      const budget = await generateBudgetSuggestions({
        profile,
        healthContext: profile.healthContext,
        maxPhp,
        currency,
      });

      res.json(budget);
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
