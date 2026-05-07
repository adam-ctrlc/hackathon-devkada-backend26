import { prisma } from "../../lib/prisma.js";
import { endOfDay, startOfDay } from "../../utils/date.js";
import { summarizeDay } from "./wellness.service.js";
import { buildDashboardMetrics } from "./analysis.service.js";
import { generateWellnessSuggestions } from "../ai/ai.service.js";

export const refreshDailySummary = async (
  profileId,
  date = new Date(),
  { skipAi = false } = {},
) => {
  const dayStart = startOfDay(date);
  const dayEnd = endOfDay(date);

  const [scans, mealLogs, diaries, waterLogs, profile] = await Promise.all([
    prisma.foodScan.findMany({
      where: { profileId, createdAt: { gte: dayStart, lte: dayEnd } },
      orderBy: { createdAt: "desc" },
    }),
    prisma.mealLog.findMany({
      where: { profileId, createdAt: { gte: dayStart, lte: dayEnd } },
      orderBy: { createdAt: "desc" },
    }),
    prisma.diaryEntry.findMany({
      where: { profileId, createdAt: { gte: dayStart, lte: dayEnd } },
      orderBy: { createdAt: "desc" },
    }),
    prisma.waterLog.findMany({
      where: { profileId, createdAt: { gte: dayStart, lte: dayEnd } },
      orderBy: { createdAt: "desc" },
    }),
    prisma.profile.findUnique({
      where: { id: profileId },
      include: { healthContext: true },
    }),
  ]);

  const foodEntries = [
    ...scans,
    ...mealLogs.map((item) => ({
      ...item,
      productName: item.matchedProductName ?? item.rawText,
      calories: item.calories,
      sugarGrams: item.sugarGrams,
      sodiumMg: item.sodiumMg,
      fatGrams: item.fatGrams,
      proteinGrams: item.proteinGrams,
      fiberGrams: item.fiberGrams,
    })),
  ];

  const waterTotalMl = waterLogs.reduce(
    (sum, item) => sum + (item.amountMl ?? 0),
    0,
  );
  const dashboardMetrics = buildDashboardMetrics({
    profile,
    scans: foodEntries,
    diaries,
    waterLogs,
  });
  const aiSummary = summarizeDay({ scans, diaries, profile });
  const aiSuggestions = skipAi
    ? {
        headline: aiSummary.headline,
        calendarNote: aiSummary.calendarNote,
        profileSignals: [],
        suggestions: [],
      }
    : await generateWellnessSuggestions({
        profile,
        healthContext: profile.healthContext,
        metrics: dashboardMetrics,
        scans: foodEntries,
        diaries,
        summaries: [],
      });

  return prisma.dailySummary.upsert({
    where: { profileId_date: { profileId, date: dayStart } },
    update: {
      score: dashboardMetrics.dailyWellnessScore,
      supportLevel:
        dashboardMetrics.dailyWellnessScore >= 80
          ? "High"
          : dashboardMetrics.dailyWellnessScore >= 50
            ? "Medium"
            : "Low",
      aiSummary: {
        ...aiSummary,
        headline: aiSuggestions.headline,
        calendarNote: aiSuggestions.calendarNote,
        profileSignals: aiSuggestions.profileSignals,
      },
      highlights: [
        foodEntries[0]
          ? `Latest scan: ${foodEntries[0].productName}`
          : "No scans yet",
        diaries.length
          ? `Diary entries: ${diaries.length}`
          : "No diary entries yet",
        `Hydration: ${dashboardMetrics.hydration.score}/100`,
        `Water logged: ${waterTotalMl} ml`,
      ],
      suggestions: aiSuggestions.suggestions,
    },
    create: {
      profileId,
      date: dayStart,
      score: dashboardMetrics.dailyWellnessScore,
      supportLevel:
        dashboardMetrics.dailyWellnessScore >= 80
          ? "High"
          : dashboardMetrics.dailyWellnessScore >= 50
            ? "Medium"
            : "Low",
      aiSummary: {
        ...aiSummary,
        headline: aiSuggestions.headline,
        calendarNote: aiSuggestions.calendarNote,
        profileSignals: aiSuggestions.profileSignals,
      },
      highlights: [
        foodEntries[0]
          ? `Latest scan: ${foodEntries[0].productName}`
          : "No scans yet",
        diaries.length
          ? `Diary entries: ${diaries.length}`
          : "No diary entries yet",
        `Hydration: ${dashboardMetrics.hydration.score}/100`,
        `Water logged: ${waterTotalMl} ml`,
      ],
      suggestions: aiSuggestions.suggestions,
    },
  });
};
