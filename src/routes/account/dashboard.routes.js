import { prisma } from "../../lib/prisma.js";
import { asyncHandler } from "../../utils/async-handler.js";
import { buildWeeklyInsights } from "../../services/wellness/insights.service.js";
import { startOfWeek } from "../../utils/date.js";
import { buildDashboardMetrics } from "../../services/wellness/analysis.service.js";
import { buildCalendarView } from "../../services/wellness/calendar.service.js";
import { analyzeWeekly } from "../../services/ai/ai.service.js";
import { buildEngagementMetrics } from "../../services/wellness/engagement.service.js";
import { getWaterIntakeRange } from "../../services/wellness/water.service.js";
import {
  buildBudgetContext,
  sumEstimatedSpend,
} from "../../services/nutrition/budget.service.js";
import { requireProfileAccess } from "../../services/profile/profile-access.service.js";

export const registerDashboardRoutes = (app) => {
  app.get(
    "/calendar/:profileId",
    asyncHandler(async (req, res) => {
      const days = Math.max(
        1,
        Math.min(90, Number(req.query.days ?? 30) || 30),
      );
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

      const summaries = await prisma.dailySummary.findMany({
        where: { profileId: req.params.profileId },
        orderBy: { date: "desc" },
        take: days,
      });

      res.json(buildCalendarView({ summaries, days }));
    }),
  );

  app.get(
    "/dashboard/:profileId",
    asyncHandler(async (req, res) => {
      const profileId = req.params.profileId;
      const profileMeta = await prisma.profile.findUnique({
        where: { id: profileId },
        select: { id: true, role: true, parentProfileId: true },
      });

      if (!profileMeta) {
        return res.status(404).json({ error: "Profile not found" });
      }

      const access = await requireProfileAccess(req, res, profileMeta);
      if (!access.allowed) {
        return;
      }

      const [
        profile,
        latestScan,
        latestDiary,
        latestMealLogs,
        latestWaterLogs,
        weekSummaries,
        waterRange,
      ] = await Promise.all([
        prisma.profile.findUnique({
          where: { id: profileId },
          include: { healthContext: true },
        }),
        prisma.foodScan.findMany({
          where: { profileId },
          orderBy: { createdAt: "desc" },
          take: 10,
        }),
        prisma.diaryEntry.findMany({
          where: { profileId },
          orderBy: { createdAt: "desc" },
          take: 10,
        }),
        prisma.mealLog.findMany({
          where: { profileId },
          orderBy: { createdAt: "desc" },
          take: 10,
        }),
        prisma.waterLog.findMany({
          where: { profileId },
          orderBy: { createdAt: "desc" },
          take: 20,
        }),
        prisma.dailySummary.findMany({
          where: {
            profileId,
            date: {
              gte: startOfWeek(new Date()),
            },
          },
          orderBy: { date: "desc" },
        }),
        getWaterIntakeRange({ profileId, days: 7 }),
      ]);

      if (!profile) {
        return res.status(404).json({ error: "Profile not found" });
      }

      const dashboard = buildDashboardMetrics({
        profile,
        scans: [...latestScan, ...latestMealLogs],
        diaries: latestDiary,
        waterLogs: latestWaterLogs,
      });

      const engagement = buildEngagementMetrics({
        scans: latestScan,
        mealLogs: latestMealLogs,
        waterLogs: latestWaterLogs,
        diaries: latestDiary,
      });

      const aiInsights = await analyzeWeekly({
        profile,
        scans: [...latestScan, ...latestMealLogs],
        diaries: latestDiary,
        summaries: weekSummaries,
      });
      const budgetContext = buildBudgetContext({
        profile,
        amountSpent: sumEstimatedSpend({
          logs: [...latestScan, ...latestMealLogs],
          currency: profile.budgetCurrency ?? profile.incomeCurrency,
        }),
        fallbackDailyBudget: 100,
        fallbackCurrency:
          profile.budgetCurrency ?? profile.incomeCurrency ?? "PHP",
      });

      const dashboardScore = weekSummaries.length
        ? Math.round(
            weekSummaries.reduce((sum, item) => sum + item.score, 0) /
              weekSummaries.length,
          )
        : 70;

      res.json({
        profile,
        latestScan: latestScan[0] ?? null,
        latestDiary: latestDiary[0] ?? null,
        latestMeal: latestMealLogs[0] ?? null,
        scanHistory: latestScan,
        mealHistory: latestMealLogs,
        diaryHistory: latestDiary,
        metrics: dashboard,
        weeklyScore: dashboardScore,
        trend:
          dashboardScore >= 80
            ? "High"
            : dashboardScore >= 50
              ? "Medium"
              : "Low",
        weeklyInsights:
          aiInsights.insights ??
          buildWeeklyInsights({
            summaries: weekSummaries,
            scans: [...latestScan, ...latestMealLogs],
            diaries: latestDiary,
          }),
        aiInsights,
        budgetContext,
        water: {
          totalMl: waterRange.totalMl,
          series: waterRange.series,
          streaks: engagement.streaks,
          rewards: engagement.rewards,
        },
      });
    }),
  );

  app.get(
    "/insights/:profileId",
    asyncHandler(async (req, res) => {
      const profileId = req.params.profileId;
      const profileMeta = await prisma.profile.findUnique({
        where: { id: profileId },
        select: { id: true, role: true, parentProfileId: true },
      });

      if (!profileMeta) {
        return res.status(404).json({ error: "Profile not found" });
      }

      const access = await requireProfileAccess(req, res, profileMeta);
      if (!access.allowed) {
        return;
      }

      const [profile, scans, diaries, mealLogs, waterLogs, summaries] =
        await Promise.all([
          prisma.profile.findUnique({ where: { id: profileId } }),
          prisma.foodScan.findMany({
            where: { profileId },
            orderBy: { createdAt: "desc" },
            take: 14,
          }),
          prisma.diaryEntry.findMany({
            where: { profileId },
            orderBy: { createdAt: "desc" },
            take: 14,
          }),
          prisma.mealLog.findMany({
            where: { profileId },
            orderBy: { createdAt: "desc" },
            take: 14,
          }),
          prisma.waterLog.findMany({
            where: { profileId },
            orderBy: { createdAt: "desc" },
            take: 20,
          }),
          prisma.dailySummary.findMany({
            where: { profileId },
            orderBy: { date: "desc" },
            take: 7,
          }),
        ]);

      if (!profile) {
        return res.status(404).json({ error: "Profile not found" });
      }

      res.json({
        insights: buildWeeklyInsights({
          scans: [...scans, ...mealLogs],
          diaries,
          summaries,
        }),
        aiInsights: await analyzeWeekly({
          profile,
          scans: [...scans, ...mealLogs],
          diaries,
          summaries,
        }),
        metrics: buildDashboardMetrics({
          profile,
          scans: [...scans, ...mealLogs],
          diaries,
          waterLogs,
        }),
        water: await getWaterIntakeRange({ profileId, days: 7 }),
      });
    }),
  );
};
