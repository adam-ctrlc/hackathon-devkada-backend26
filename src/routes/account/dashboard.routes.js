import { prisma } from "../../lib/prisma.js";
import { asyncHandler } from "../../utils/async-handler.js";
import { startOfWeek } from "../../utils/date.js";
import { buildDashboardMetrics } from "../../services/wellness/analysis.service.js";
import { buildCalendarView } from "../../services/wellness/calendar.service.js";
import { buildEngagementMetrics } from "../../services/wellness/engagement.service.js";
import { getWaterIntakeRange } from "../../services/wellness/water.service.js";
import { buildWeeklyMlInsights } from "../../services/wellness/weekly-insights-ml.service.js";
import {
  buildBudgetContext,
  sumEstimatedSpend,
} from "../../services/nutrition/budget.service.js";
import { requireProfileAccess } from "../../services/profile/profile-access.service.js";
import {
  buildProfileContext,
  callGemini,
} from "../../services/ai/ai-core.service.js";

const dayKey = (value) => new Date(value).toISOString().slice(0, 10);

const groupBudgetLogsByDate = (logs = []) => {
  const map = new Map();
  for (const log of logs) {
    const key = dayKey(log.spentAt ?? log.plannedFor ?? log.createdAt);
    const current = map.get(key) ?? [];
    current.push(log);
    map.set(key, current);
  }
  return map;
};

const buildMealTimingSummary = (entries = []) =>
  entries.reduce((acc, entry) => {
    const key = String(entry.mealPeriod ?? "")
      .trim()
      .toLowerCase();
    if (!key) {
      return acc;
    }

    acc[key] = (acc[key] ?? 0) + 1;
    return acc;
  }, {});

const foodEntryName = (entry = {}) =>
  String(
    entry.productName ??
      entry.matchedProductName ??
      entry.rawText ??
      entry.foodType ??
      "Logged food",
  )
    .trim()
    .slice(0, 48);

const listFoodNames = (entries = []) =>
  entries.map(foodEntryName).filter(Boolean).slice(0, 3).join(", ");

const average = (values = []) =>
  values.length
    ? values.reduce((sum, value) => sum + Number(value || 0), 0) / values.length
    : 0;

const toDayKey = (value) => new Date(value).toISOString().slice(0, 10);
const DASHBOARD_REFLECTION_KIND = "dashboard";
const DASHBOARD_REFLECTION_TTL_MS = 5 * 60 * 60 * 1000;
const dashboardReflectionJobs = new Map();

const parseDashboardReflection = (value = {}, fallback = {}) => {
  const reflection = String(value?.reflection ?? fallback.reflection ?? "")
    .trim()
    .slice(0, 600);
  const mentalMotivation = String(
    value?.mentalMotivation ?? fallback.mentalMotivation ?? "",
  )
    .trim()
    .slice(0, 220);
  const physicalMotivation = String(
    value?.physicalMotivation ?? fallback.physicalMotivation ?? "",
  )
    .trim()
    .slice(0, 220);
  const whyThisMatters = String(
    value?.whyThisMatters ?? fallback.whyThisMatters ?? "",
  )
    .trim()
    .slice(0, 260);

  return {
    reflection:
      reflection ||
      "Your current logs show real effort. Keep one consistent food and hydration win today.",
    mentalMotivation:
      mentalMotivation ||
      "You are building consistency. A calmer next meal can support focus and mood.",
    physicalMotivation:
      physicalMotivation ||
      "Small physical steps count today. Keep movement gentle and consistent.",
    whyThisMatters:
      whyThisMatters ||
      "Your profile and recent logs help personalize guidance so each next step is more relevant.",
  };
};

const buildDashboardReflectionPayload = ({
  profile,
  healthContext,
  metrics,
  scans,
  mealLogs,
  waterLogs,
  diaries,
  sleepLogs,
  workoutLogs,
}) => {
  const foodEntries = [...(scans ?? []), ...(mealLogs ?? [])]
    .sort(
      (a, b) =>
        new Date(b.eatenAt ?? b.createdAt).getTime() -
        new Date(a.eatenAt ?? a.createdAt).getTime(),
    )
    .slice(0, 10)
    .map((entry) => ({
      name: foodEntryName(entry),
      supportLevel: entry.supportLevel ?? null,
      score: entry.score ?? null,
      sugarGrams: entry.sugarGrams ?? null,
      sodiumMg: entry.sodiumMg ?? null,
      mealPeriod: entry.mealPeriod ?? null,
    }));

  const waterTotal = (waterLogs ?? []).reduce(
    (sum, row) => sum + Number(row.amountMl ?? 0),
    0,
  );
  const avgSleep = (sleepLogs ?? []).length
    ? average((sleepLogs ?? []).map((row) => Number(row.hours ?? 0)))
    : 0;

  return {
    profile: buildProfileContext(profile, healthContext),
    metrics: {
      mentalStatus: metrics?.mental?.status ?? null,
      stressLevel: metrics?.mental?.stressLevel ?? null,
      moodTag: metrics?.mental?.moodTag ?? null,
      physicalStatus: metrics?.physical?.status ?? null,
      workoutSessions7d: metrics?.physical?.workoutSessions7d ?? 0,
      waterTargetMl: metrics?.waterTargetMl ?? 2000,
      dailyWellnessScore: metrics?.dailyWellnessScore ?? null,
    },
    recentFood: foodEntries,
    hydration: {
      entries: (waterLogs ?? []).length,
      totalMl: Math.round(waterTotal),
    },
    sleep: {
      entries: (sleepLogs ?? []).length,
      avgHours: Number(avgSleep.toFixed(1)),
    },
    workouts: {
      entries: (workoutLogs ?? []).length,
    },
    diary: {
      entries: (diaries ?? []).length,
      latest: diaries?.[0]?.entry ?? null,
      latestReflection: diaries?.[0]?.aiReflection ?? null,
    },
  };
};

const refreshDashboardReflection = async ({
  profileId,
  profile,
  healthContext,
  metrics,
  scans,
  mealLogs,
  waterLogs,
  diaries,
  sleepLogs,
  workoutLogs,
}) => {
  const payload = buildDashboardReflectionPayload({
    profile,
    healthContext,
    metrics,
    scans,
    mealLogs,
    waterLogs,
    diaries,
    sleepLogs,
    workoutLogs,
  });
  let geminiResult = {};
  try {
    geminiResult =
      (await callGemini("dashboard-reflection", payload, {
        timeoutMs: 60000,
      })) ?? {};
  } catch {
    geminiResult = {};
  }
  const parsed = parseDashboardReflection(geminiResult);

  await prisma.aiReflectionCache.upsert({
    where: {
      profileId_kind: {
        profileId,
        kind: DASHBOARD_REFLECTION_KIND,
      },
    },
    update: {
      reflection: parsed.reflection,
      mentalMotivation: parsed.mentalMotivation,
      physicalMotivation: parsed.physicalMotivation,
      whyThisMatters: parsed.whyThisMatters,
      payload: geminiResult,
      generatedAt: new Date(),
    },
    create: {
      profileId,
      kind: DASHBOARD_REFLECTION_KIND,
      reflection: parsed.reflection,
      mentalMotivation: parsed.mentalMotivation,
      physicalMotivation: parsed.physicalMotivation,
      whyThisMatters: parsed.whyThisMatters,
      payload: geminiResult,
      generatedAt: new Date(),
    },
  });

  return parsed;
};

const buildScannerMotivation = ({
  lowSupportRatio,
  hydrationRatio,
  sessions14d,
  avgEnergy,
  avgStress,
}) => {
  if (hydrationRatio >= 0.9 && lowSupportRatio <= 0.4) {
    return "You're building a steady routine. Small consistent choices are adding up.";
  }
  if (sessions14d >= 3 && avgEnergy >= 3.2) {
    return "Your movement consistency is helping your day-to-day energy. Keep that rhythm going.";
  }
  if (avgStress >= 3.8) {
    return "You’re doing your best through a stressful stretch. One small supportive meal choice still counts.";
  }
  if (lowSupportRatio > 0.6) {
    return "Progress can start with one better next meal. You don’t need a perfect week to improve your trend.";
  }
  return "You’re still in the game. One practical step today can make tomorrow feel easier.";
};

const buildContextReasons = ({
  foodEntries = [],
  waterLogs = [],
  sleepLogs = [],
}) => {
  const lowSupport = foodEntries.filter((entry) => {
    const support = String(entry.supportLevel ?? "").toLowerCase();
    return (
      support === "low" || support === "medium" || Number(entry.score) < 70
    );
  });
  const highSugar = foodEntries.filter(
    (entry) => Number(entry.sugarGrams ?? 0) >= 10,
  );
  const highSodium = foodEntries.filter(
    (entry) => Number(entry.sodiumMg ?? 0) >= 600,
  );
  const lowProteinFiber = foodEntries.filter(
    (entry) =>
      Number(entry.proteinGrams ?? 0) < 10 && Number(entry.fiberGrams ?? 0) < 3,
  );
  const waterTotal = waterLogs.reduce(
    (sum, log) => sum + Number(log.amountMl ?? 0),
    0,
  );
  const sleepAvgHours = sleepLogs.length
    ? sleepLogs.reduce((sum, log) => sum + Number(log.hours ?? 0), 0) /
      sleepLogs.length
    : 0;

  return [
    lowSupport.length
      ? `Lower-support foods this week included ${listFoodNames(lowSupport)}.`
      : null,
    highSugar.length
      ? `Sugar pressure came from ${listFoodNames(highSugar)}.`
      : null,
    highSodium.length
      ? `Sodium looked higher around ${listFoodNames(highSodium)}.`
      : null,
    lowProteinFiber.length
      ? `Protein and fiber looked lighter in ${listFoodNames(lowProteinFiber)}.`
      : null,
    waterLogs.length
      ? `Hydration is based on ${waterTotal.toFixed(0)}ml logged across ${waterLogs.length} water entries.`
      : null,
    sleepLogs.length
      ? `Sleep trend averages ${sleepAvgHours.toFixed(1)}h across ${sleepLogs.length} sleep logs.`
      : null,
  ].filter(Boolean);
};

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
      const [budgetLogs, scans, mealLogs, waterLogs, sleepLogs] =
        await Promise.all([
          prisma.foodBudgetLog.findMany({
            where: { profileId: req.params.profileId },
            orderBy: { createdAt: "desc" },
            take: 120,
          }),
          prisma.foodScan.findMany({
            where: { profileId: req.params.profileId },
            orderBy: { eatenAt: "desc" },
            take: 120,
          }),
          prisma.mealLog.findMany({
            where: { profileId: req.params.profileId },
            orderBy: { eatenAt: "desc" },
            take: 120,
          }),
          prisma.waterLog.findMany({
            where: { profileId: req.params.profileId },
            orderBy: { drankAt: "desc" },
            take: 120,
          }),
          prisma.sleepLog.findMany({
            where: { profileId: req.params.profileId },
            orderBy: { sleptAt: "desc" },
            take: 120,
          }),
        ]);

      const calendarView = buildCalendarView({ summaries, days });
      const budgetByDate = groupBudgetLogsByDate(budgetLogs);
      const foodEntries = [...scans, ...mealLogs];
      const entriesByDate = foodEntries.reduce((map, entry) => {
        const key = dayKey(entry.eatenAt ?? entry.createdAt);
        const current = map.get(key) ?? [];
        current.push(entry);
        map.set(key, current);
        return map;
      }, new Map());
      const waterByDate = waterLogs.reduce((map, log) => {
        const key = dayKey(log.drankAt ?? log.createdAt);
        const current = map.get(key) ?? [];
        current.push(log);
        map.set(key, current);
        return map;
      }, new Map());
      const sleepByDate = sleepLogs.reduce((map, log) => {
        const key = dayKey(log.sleptAt ?? log.createdAt);
        const current = map.get(key) ?? [];
        current.push(log);
        map.set(key, current);
        return map;
      }, new Map());

      res.json({
        ...calendarView,
        calendar: calendarView.calendar.map((item) => {
          const dayBudgetLogs = budgetByDate.get(item.date) ?? [];
          const dayEntries = entriesByDate.get(item.date) ?? [];
          const dayWaterLogs = waterByDate.get(item.date) ?? [];
          const daySleepLogs = sleepByDate.get(item.date) ?? [];
          return {
            ...item,
            budgetLogs: dayBudgetLogs,
            budgetTotal: dayBudgetLogs.reduce(
              (sum, log) => sum + log.amount,
              0,
            ),
            mealPeriods: buildMealTimingSummary(dayEntries),
            foodEntryCount: dayEntries.length,
            foodEntries: dayEntries.slice(0, 8).map((entry) => ({
              id: entry.id,
              name: foodEntryName(entry),
              foodType: entry.foodType,
              score: entry.score,
              supportLevel: entry.supportLevel,
              calories: entry.calories,
              sugarGrams: entry.sugarGrams,
              sodiumMg: entry.sodiumMg,
              proteinGrams: entry.proteinGrams,
              fiberGrams: entry.fiberGrams,
              mealPeriod: entry.mealPeriod,
              eatenAt: entry.eatenAt ?? entry.createdAt,
            })),
            waterLogs: dayWaterLogs,
            waterTotalMl: dayWaterLogs.reduce(
              (sum, log) => sum + Number(log.amountMl ?? 0),
              0,
            ),
            sleepLogs: daySleepLogs,
            sleepTotalHours: daySleepLogs.reduce(
              (sum, log) => sum + Number(log.hours ?? 0),
              0,
            ),
            sleepAverageHours: daySleepLogs.length
              ? Number(
                  (
                    daySleepLogs.reduce(
                      (sum, log) => sum + Number(log.hours ?? 0),
                      0,
                    ) / daySleepLogs.length
                  ).toFixed(2),
                )
              : 0,
          };
        }),
      });
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
        latestSleepLogs,
        latestWorkoutLogs,
        latestBudgetLogs,
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
        prisma.sleepLog.findMany({
          where: { profileId },
          orderBy: [{ sleptAt: "desc" }, { createdAt: "desc" }],
          take: 20,
        }),
        prisma.workoutLog.findMany({
          where: { profileId },
          orderBy: { createdAt: "desc" },
          take: 20,
        }),
        prisma.foodBudgetLog.findMany({
          where: { profileId },
          orderBy: [
            { spentAt: "desc" },
            { plannedFor: "desc" },
            { createdAt: "desc" },
          ],
          take: 12,
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

      const mealPeriods = buildMealTimingSummary([
        ...latestScan,
        ...latestMealLogs,
      ]);
      const sleepTodayHours = latestSleepLogs
        .filter(
          (log) => dayKey(log.sleptAt ?? log.createdAt) === dayKey(new Date()),
        )
        .reduce((sum, log) => sum + Number(log.hours ?? 0), 0);
      const sleepAvg7Hours = Number(
        (
          latestSleepLogs
            .slice(0, 7)
            .reduce((sum, log) => sum + Number(log.hours ?? 0), 0) /
          Math.max(1, latestSleepLogs.slice(0, 7).length)
        ).toFixed(2),
      );
      const latestDiaryEntry = latestDiary[0] ?? null;
      const mentalSummary = {
        moodScore: dashboard.moodSupport?.score ?? 50,
        energyScore: dashboard.energySupport?.score ?? 50,
        stressLevel: Number(latestDiaryEntry?.stressLevel ?? 0) || null,
        moodTag: latestDiaryEntry?.moodTag ?? null,
        status:
          (dashboard.moodSupport?.score ?? 50) >= 70 &&
          (dashboard.energySupport?.score ?? 50) >= 70
            ? "Stable"
            : (dashboard.moodSupport?.score ?? 50) < 45 ||
                Number(latestDiaryEntry?.stressLevel ?? 0) >= 4
              ? "Needs support"
              : "Watch",
      };
      const physicalSummary = {
        nutritionScore: dashboard.nutrition?.score ?? 50,
        hydrationScore: dashboard.hydration?.score ?? 50,
        heartScore: dashboard.heartHealth?.score ?? 50,
        digestionScore: dashboard.digestion?.score ?? 50,
        workoutSessions7d: latestWorkoutLogs.filter(
          (item) =>
            Date.now() - new Date(item.createdAt).getTime() <=
            7 * 24 * 60 * 60 * 1000,
        ).length,
        status:
          (dashboard.nutrition?.score ?? 50) >= 70 &&
          (dashboard.hydration?.score ?? 50) >= 70
            ? "On track"
            : (dashboard.nutrition?.score ?? 50) < 45 ||
                (dashboard.hydration?.score ?? 50) < 45
              ? "Needs support"
              : "Building",
      };
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
      const weeklyAnalysis = buildWeeklyMlInsights({
        profile,
        metrics: dashboard,
        scans: [...latestScan, ...latestMealLogs],
        diaries: latestDiary,
        summaries: weekSummaries,
        waterLogs: latestWaterLogs,
        mealTiming: mealPeriods,
        budget: budgetContext,
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
        weeklyInsights: weeklyAnalysis.insights ?? [],
        aiInsights: weeklyAnalysis,
        budgetContext,
        water: {
          totalMl: waterRange.totalMl,
          series: waterRange.series,
          streaks: engagement.streaks,
          rewards: engagement.rewards,
        },
        sleep: {
          totalHours: latestSleepLogs.reduce(
            (sum, log) => sum + Number(log.hours ?? 0),
            0,
          ),
          todayHours: Number(sleepTodayHours.toFixed(2)),
          avg7Hours: sleepAvg7Hours,
          logs: latestSleepLogs,
        },
        mental: mentalSummary,
        physical: physicalSummary,
        budgetLogs: latestBudgetLogs,
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

      const [
        profile,
        scans,
        diaries,
        mealLogs,
        waterLogs,
        summaries,
        budgetLogs,
      ] = await Promise.all([
        prisma.profile.findUnique({
          where: { id: profileId },
          include: { healthContext: true },
        }),
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
        prisma.foodBudgetLog.findMany({
          where: { profileId },
          orderBy: { createdAt: "desc" },
          take: 30,
        }),
      ]);

      if (!profile) {
        return res.status(404).json({ error: "Profile not found" });
      }

      const foodEntries = [...scans, ...mealLogs];
      const mealPeriods = buildMealTimingSummary(foodEntries);
      const contextReasons = buildContextReasons({ foodEntries, waterLogs });
      const spent = budgetLogs
        .filter((log) => log.entryType === "spent")
        .reduce((sum, log) => sum + log.amount, 0);
      const planned = budgetLogs
        .filter((log) => log.entryType !== "spent")
        .reduce((sum, log) => sum + log.amount, 0);
      const budgetContext = buildBudgetContext({
        profile,
        amountSpent: spent,
        fallbackDailyBudget: 100,
        fallbackCurrency: profile.budgetCurrency ?? "PHP",
      });
      const metrics = buildDashboardMetrics({
        profile,
        scans: [...scans, ...mealLogs],
        diaries,
        waterLogs,
      });
      const weeklyAnalysis = buildWeeklyMlInsights({
        profile,
        metrics,
        scans: foodEntries,
        diaries,
        summaries,
        waterLogs,
        mealTiming: mealPeriods,
        budget: { ...budgetContext, spent, planned },
        contextReasons,
      });
      const profileSummary = {
        id: profile.id,
        firstName: profile.firstName,
        lastName: profile.lastName,
        age: profile.age,
        sex: profile.sex,
        heightCm: profile.heightCm,
        weightKg: profile.weightKg,
        activityLevel: profile.activityLevel,
        healthGoal: profile.healthGoal,
        budgetAmount: profile.budgetAmount,
        budgetFrequency: profile.budgetFrequency,
        budgetCurrency: profile.budgetCurrency,
        healthContext: profile.healthContext
          ? {
              status: profile.healthContext.status,
              notes: profile.healthContext.notes,
              customRestriction: profile.healthContext.customRestriction,
            }
          : null,
      };

      res.json({
        profile: profileSummary,
        insights: weeklyAnalysis.insights ?? [],
        aiInsights: weeklyAnalysis,
        metrics,
        contextReasons,
        water: await getWaterIntakeRange({ profileId, days: 7 }),
        mealTiming: mealPeriods,
        budget: {
          logs: budgetLogs,
          spent,
          planned,
          budgetAmount: profile.budgetAmount,
          budgetCurrency: profile.budgetCurrency ?? "PHP",
          budgetFrequency: profile.budgetFrequency ?? "monthly",
        },
      });
    }),
  );

  app.get(
    "/dashboard-reflection/:profileId",
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

      const cache = await prisma.aiReflectionCache.findUnique({
        where: {
          profileId_kind: {
            profileId,
            kind: DASHBOARD_REFLECTION_KIND,
          },
        },
      });
      const cacheAgeMs = cache
        ? Date.now() - new Date(cache.generatedAt).getTime()
        : Number.POSITIVE_INFINITY;
      const isFresh = cacheAgeMs <= DASHBOARD_REFLECTION_TTL_MS;

      const fallbackData = parseDashboardReflection({
        reflection: cache?.reflection,
        mentalMotivation: cache?.mentalMotivation,
        physicalMotivation: cache?.physicalMotivation,
        whyThisMatters: cache?.whyThisMatters,
      });

      if (isFresh && cache) {
        return res.json({
          ...fallbackData,
          generatedAt: cache.generatedAt,
          generating: false,
        });
      }

      const existingJob = dashboardReflectionJobs.get(profileId);
      if (existingJob) {
        return res.json({
          ...fallbackData,
          generatedAt: cache?.generatedAt ?? null,
          generating: true,
        });
      }

      const refreshPromise = (async () => {
        const [
          profile,
          scans,
          mealLogs,
          waterLogs,
          diaries,
          sleepLogs,
          workoutLogs,
        ] = await Promise.all([
          prisma.profile.findUnique({
            where: { id: profileId },
            include: { healthContext: true },
          }),
          prisma.foodScan.findMany({
            where: { profileId },
            orderBy: { createdAt: "desc" },
            take: 16,
          }),
          prisma.mealLog.findMany({
            where: { profileId },
            orderBy: { createdAt: "desc" },
            take: 16,
          }),
          prisma.waterLog.findMany({
            where: { profileId },
            orderBy: { createdAt: "desc" },
            take: 20,
          }),
          prisma.diaryEntry.findMany({
            where: { profileId },
            orderBy: { createdAt: "desc" },
            take: 10,
          }),
          prisma.sleepLog.findMany({
            where: { profileId },
            orderBy: [{ sleptAt: "desc" }, { createdAt: "desc" }],
            take: 14,
          }),
          prisma.workoutLog.findMany({
            where: { profileId },
            orderBy: { createdAt: "desc" },
            take: 14,
          }),
        ]);

        if (!profile) {
          throw new Error("Profile not found");
        }

        const metrics = buildDashboardMetrics({
          profile,
          scans: [...scans, ...mealLogs],
          diaries,
          waterLogs,
        });

        return refreshDashboardReflection({
          profileId,
          profile,
          healthContext: profile.healthContext ?? null,
          metrics,
          scans,
          mealLogs,
          waterLogs,
          diaries,
          sleepLogs,
          workoutLogs,
        });
      })();

      dashboardReflectionJobs.set(profileId, refreshPromise);
      refreshPromise
        .catch(() => {})
        .finally(() => {
          dashboardReflectionJobs.delete(profileId);
        });

      if (!cache) {
        try {
          const generated = await refreshPromise;
          const freshCache = await prisma.aiReflectionCache.findUnique({
            where: {
              profileId_kind: {
                profileId,
                kind: DASHBOARD_REFLECTION_KIND,
              },
            },
          });
          return res.json({
            ...generated,
            generatedAt: freshCache?.generatedAt ?? new Date(),
            generating: false,
          });
        } catch {
          return res.json({
            ...fallbackData,
            generatedAt: null,
            generating: false,
          });
        }
      }

      return res.json({
        ...fallbackData,
        generatedAt: cache.generatedAt,
        generating: true,
      });
    }),
  );

  app.get(
    "/scanner-context/:profileId",
    asyncHandler(async (req, res) => {
      const profileId = req.params.profileId;
      const days = Math.max(
        7,
        Math.min(90, Number(req.query.days ?? 30) || 30),
      );
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
        scans,
        mealLogs,
        waterLogs,
        workoutLogs,
        sleepLogs,
        diaries,
        summaries,
      ] = await Promise.all([
        prisma.profile.findUnique({
          where: { id: profileId },
          include: { healthContext: true },
        }),
        prisma.foodScan.findMany({
          where: { profileId },
          orderBy: { createdAt: "desc" },
        }),
        prisma.mealLog.findMany({
          where: { profileId },
          orderBy: { createdAt: "desc" },
        }),
        prisma.waterLog.findMany({
          where: { profileId },
          orderBy: { createdAt: "desc" },
        }),
        prisma.workoutLog.findMany({
          where: { profileId },
          orderBy: { createdAt: "desc" },
        }),
        prisma.sleepLog.findMany({
          where: { profileId },
          orderBy: { sleptAt: "desc" },
        }),
        prisma.diaryEntry.findMany({
          where: { profileId },
          orderBy: { createdAt: "desc" },
        }),
        prisma.dailySummary.findMany({
          where: { profileId },
          orderBy: { date: "desc" },
          take: days,
        }),
      ]);

      if (!profile) {
        return res.status(404).json({ error: "Profile not found" });
      }

      const foodEntries = [...scans, ...mealLogs].sort(
        (a, b) =>
          new Date(b.eatenAt ?? b.createdAt).getTime() -
          new Date(a.eatenAt ?? a.createdAt).getTime(),
      );
      const trackedFood = foodEntries.slice(0, Math.max(30, days));
      const lowSupportEntries = trackedFood.filter((entry) => {
        const level = String(entry.supportLevel ?? "").toLowerCase();
        return (
          level === "low" || level === "medium" || Number(entry.score ?? 0) < 70
        );
      });
      const highSodiumEntries = trackedFood.filter(
        (entry) => Number(entry.sodiumMg ?? 0) >= 700,
      );
      const highSugarEntries = trackedFood.filter(
        (entry) => Number(entry.sugarGrams ?? 0) >= 14,
      );

      const metrics = buildDashboardMetrics({
        profile,
        scans: foodEntries,
        diaries,
        waterLogs,
      });
      const waterByDay = waterLogs.reduce((map, log) => {
        const key = toDayKey(log.drankAt ?? log.createdAt);
        map.set(key, (map.get(key) ?? 0) + Number(log.amountMl ?? 0));
        return map;
      }, new Map());
      const dailyWater = [...waterByDay.values()].slice(0, days);
      const avgDailyWaterMl = Math.round(average(dailyWater));
      const waterTargetMl = Number(metrics.waterTargetMl ?? 2000);
      const hydrationRatio = avgDailyWaterMl / Math.max(1, waterTargetMl);

      const recentWorkouts = workoutLogs.filter(
        (item) =>
          Date.now() - new Date(item.createdAt).getTime() <=
          14 * 24 * 60 * 60 * 1000,
      );
      const workoutDays14 = new Set(
        recentWorkouts.map((item) => toDayKey(item.createdAt)),
      ).size;
      const workoutMinutes14 = recentWorkouts.reduce(
        (sum, item) => sum + Number(item.durationMinutes ?? 0),
        0,
      );

      const recentDiaries = diaries.filter(
        (item) =>
          Date.now() - new Date(item.createdAt).getTime() <=
          14 * 24 * 60 * 60 * 1000,
      );
      const avgEnergy = average(
        recentDiaries.map((item) => Number(item.energyLevel ?? 3)),
      );
      const avgStress = average(
        recentDiaries.map((item) => Number(item.stressLevel ?? 3)),
      );
      const sleepByDay = new Map();
      for (const log of sleepLogs) {
        const key = toDayKey(log.sleptAt ?? log.createdAt);
        sleepByDay.set(
          key,
          (sleepByDay.get(key) ?? 0) + Number(log.hours ?? 0),
        );
      }
      for (const diary of recentDiaries) {
        if (diary.sleepHours == null) continue;
        const key = toDayKey(diary.createdAt);
        if (!sleepByDay.has(key)) {
          sleepByDay.set(key, Number(diary.sleepHours ?? 0));
        }
      }
      const sleepValues = [...sleepByDay.values()].slice(0, days);
      const avgSleepHours = average(sleepValues);
      const todaySleepHours = sleepByDay.get(toDayKey(new Date())) ?? 0;
      const shortSleepDays = sleepValues.filter(
        (hours) => Number(hours) < 6,
      ).length;
      const lowEnergyDays = recentDiaries.filter(
        (item) => Number(item.energyLevel ?? 3) <= 2,
      ).length;
      const highStressDays = recentDiaries.filter(
        (item) => Number(item.stressLevel ?? 3) >= 4,
      ).length;

      const lowSupportRatio = trackedFood.length
        ? lowSupportEntries.length / trackedFood.length
        : 0;
      let riskScore = 0;
      if (lowSupportRatio >= 0.6) riskScore += 1;
      if (highSodiumEntries.length >= 3 || highSugarEntries.length >= 3)
        riskScore += 1;
      if (hydrationRatio < 0.8) riskScore += 1;
      if (workoutDays14 <= 1) riskScore += 1;
      if (avgEnergy <= 2.7 || avgStress >= 3.8 || shortSleepDays >= 3)
        riskScore += 1;
      const mentalRiskLevel =
        riskScore >= 4 ? "high" : riskScore >= 2 ? "moderate" : "low";

      const supportLevelCounts = summaries.reduce((acc, item) => {
        const key = String(item.supportLevel ?? "No Data");
        acc[key] = (acc[key] ?? 0) + 1;
        return acc;
      }, {});

      res.json({
        generatedAt: new Date().toISOString(),
        periodDays: days,
        food: {
          entries: trackedFood.length,
          lowSupportEntries: lowSupportEntries.length,
          lowSupportRatio: Number(lowSupportRatio.toFixed(2)),
          highSodiumEntries: highSodiumEntries.length,
          highSugarEntries: highSugarEntries.length,
          recentFoods: trackedFood
            .slice(0, 5)
            .map((item) => foodEntryName(item)),
        },
        hydration: {
          avgDailyMl: avgDailyWaterMl,
          targetMl: waterTargetMl,
          ratio: Number(hydrationRatio.toFixed(2)),
          level:
            hydrationRatio >= 0.9
              ? "steady"
              : hydrationRatio >= 0.7
                ? "building"
                : "behind",
        },
        workout: {
          sessions14d: recentWorkouts.length,
          activeDays14d: workoutDays14,
          minutes14d: workoutMinutes14,
        },
        diary: {
          entries14d: recentDiaries.length,
          avgEnergy: Number(avgEnergy.toFixed(2)),
          avgStress: Number(avgStress.toFixed(2)),
          lowEnergyDays,
          highStressDays,
          shortSleepDays,
        },
        sleep: {
          entries: sleepLogs.length,
          avgHours: Number(avgSleepHours.toFixed(2)),
          todayHours: Number(todaySleepHours.toFixed(2)),
          shortSleepDays,
          level:
            avgSleepHours >= 7
              ? "steady"
              : avgSleepHours >= 6
                ? "building"
                : "behind",
        },
        summary: {
          supportLevels: supportLevelCounts,
          mentalRiskLevel,
        },
        motivationText: buildScannerMotivation({
          lowSupportRatio,
          hydrationRatio,
          sessions14d: recentWorkouts.length,
          avgEnergy,
          avgStress,
        }),
        checkIn: {
          question: "How have you been feeling after meals lately?",
          options: [
            { id: "good", label: "Good and steady" },
            { id: "okay", label: "Okay but up and down" },
            { id: "low_energy", label: "Low energy" },
            { id: "stressed", label: "Stressed or overwhelmed" },
          ],
          troubleOptions: [
            { id: "sleep_trouble", label: "Sleep trouble" },
            { id: "anxious", label: "Anxious thoughts" },
            { id: "overthinking", label: "Overthinking" },
            { id: "low_motivation", label: "Low motivation" },
          ],
        },
      });
    }),
  );
};
