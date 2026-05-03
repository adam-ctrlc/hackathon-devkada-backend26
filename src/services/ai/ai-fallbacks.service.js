import {
  buildDashboardMetrics,
  buildStatusRecommendation,
} from "../wellness/analysis.service.js";
import {
  scoreFood,
  buildDiaryReflection,
  summarizeDay,
} from "../wellness/wellness.service.js";
import { inferFoodType } from "../nutrition/meal-knowledge.service.js";

export const fallbackScanAnalysis = ({
  profile,
  healthContext,
  productName,
  nutrition,
  scoreResult,
  profileContext,
}) => ({
  source: "fallback",
  kind: "scan",
  foodType: inferFoodType({ mealText: productName }),
  summary: `${productName} scores ${scoreResult.score}/100 and is ${scoreResult.supportLevel} support.`,
  patternSummary:
    profileContext?.signals?.[0] ??
    "Your profile suggests a balanced eating pattern.",
  wellnessImpact: scoreResult.wellnessImpact,
  flags: scoreResult.notes,
  alternatives: scoreResult.betterAlternatives,
  suggestion: scoreResult.betterAlternatives[0] ?? "Water",
  contextHint: buildStatusRecommendation(
    healthContext?.status ?? profile?.healthContext?.status ?? null,
  ),
  profileSignals: profileContext?.signals ?? [],
});

export const fallbackDiaryAnalysis = ({
  entry,
  moodTag,
  energyLevel,
  stressLevel,
  sleepHours,
  waterIntakeMl,
  activityMinutes,
  scanSignals,
}) => ({
  source: "fallback",
  kind: "diary",
  reflection: buildDiaryReflection({
    entry,
    moodTag,
    energyLevel,
    stressLevel,
    sleepHours,
    waterIntakeMl,
    activityMinutes,
    scanSignals,
  }),
  patternHints: [
    energyLevel <= 3 ? "Energy is low." : "Energy is okay.",
    stressLevel >= 4 ? "Stress is high." : "Stress is manageable.",
    (waterIntakeMl ?? 0) < 1500
      ? "Hydration may be low."
      : "Hydration looks better.",
  ],
});

export const fallbackWeeklyAnalysis = ({
  profile,
  scans,
  diaries,
  summaries,
}) => {
  const metrics = buildDashboardMetrics({ profile, scans, diaries });
  const daily = summarizeDay({ scans, diaries, profile });

  return {
    source: "fallback",
    kind: "weekly",
    summary: `Daily wellness is ${metrics.dailyWellnessScore}/100 with ${metrics.nutrition.level} nutrition support.`,
    insights: [
      `Hydration: ${metrics.hydration.level}`,
      `Mood: ${metrics.moodSupport.level}`,
      `Energy: ${metrics.energySupport.level}`,
      `Heart health: ${metrics.heartHealth.level}`,
      `Digestion: ${metrics.digestion.level}`,
    ],
    suggestions: [
      ...daily.suggestions,
      ...summaries.slice(0, 2).map((item) => item.supportLevel),
    ],
    metrics,
  };
};

export const fallbackMealAnalysis = ({
  profile,
  healthContext,
  mealText,
  foodData,
  scoreResult,
  source,
  profileContext,
  localEstimate = null,
  recognizedFoods = [],
  confidence = null,
  extra = {},
}) => ({
  source: source ?? "fallback",
  kind: "meal",
  mealName:
    extra.mealName ??
    foodData?.productName ??
    localEstimate?.mealName ??
    mealText,
  foodType: extra.foodType ?? localEstimate?.foodType ?? null,
  summary:
    extra.summary ??
    `${foodData?.productName ?? localEstimate?.mealName ?? mealText} scores ${scoreResult.score}/100 and is ${scoreResult.supportLevel} support.`,
  patternSummary:
    extra.patternSummary ??
    profileContext?.signals?.[0] ??
    "Your profile suggests a balanced eating pattern.",
  recognizedFoods: extra.recognizedFoods ?? recognizedFoods,
  confidence: extra.confidence ?? confidence,
  nutrition: {
    calories:
      foodData?.nutrition?.calories ??
      localEstimate?.nutrition?.calories ??
      null,
    sugarGrams:
      foodData?.nutrition?.sugarGrams ??
      localEstimate?.nutrition?.sugarGrams ??
      null,
    sodiumMg:
      foodData?.nutrition?.sodiumMg ??
      localEstimate?.nutrition?.sodiumMg ??
      null,
    fatGrams:
      foodData?.nutrition?.fatGrams ??
      localEstimate?.nutrition?.fatGrams ??
      null,
    proteinGrams:
      foodData?.nutrition?.proteinGrams ??
      localEstimate?.nutrition?.proteinGrams ??
      null,
    fiberGrams:
      foodData?.nutrition?.fiberGrams ??
      localEstimate?.nutrition?.fiberGrams ??
      null,
  },
  flags: extra.flags ?? scoreResult.notes,
  warnings: extra.warnings ?? scoreResult.notes,
  alternatives: extra.alternatives ?? scoreResult.betterAlternatives,
  groceryList: extra.groceryList ?? localEstimate?.groceryList ?? [],
  budgetEstimatePhp:
    extra.budgetEstimatePhp ?? localEstimate?.priceEstimatePhp ?? null,
  suggestion: extra.suggestion ?? scoreResult.betterAlternatives[0] ?? "Water",
  contextHint: buildStatusRecommendation(
    healthContext?.status ?? profile?.healthContext?.status ?? null,
  ),
  profileSignals: extra.profileSignals ?? profileContext?.signals ?? [],
  budgetContext: extra.budgetContext ?? null,
});

export const fallbackManualMealAnalysis = (args) => ({
  ...fallbackMealAnalysis(args),
  kind: "manual-meal",
});

export const fallbackPhotoMealAnalysis = (args) => ({
  ...fallbackMealAnalysis(args),
  kind: "photo-meal",
});

export const fallbackSuggestionBundle = ({
  profile,
  healthContext,
  metrics,
}) => {
  const suggestions = [];

  if ((metrics?.hydration?.score ?? 0) < 50) {
    suggestions.push({
      title: "Hydrate more today",
      reason: "Hydration is running low.",
      action: "Drink water steadily across the day.",
      priority: "High",
      category: "hydration",
    });
  }

  if ((metrics?.nutrition?.score ?? 0) < 60) {
    suggestions.push({
      title: "Improve meal balance",
      reason: "Food support is still uneven.",
      action: "Add protein and fiber to the next meal.",
      priority: "High",
      category: "food",
    });
  }

  if ((metrics?.energySupport?.score ?? 0) < 60) {
    suggestions.push({
      title: "Protect energy",
      reason: "Energy support looks weak.",
      action: "Eat a steadier breakfast and avoid long gaps between meals.",
      priority: "Medium",
      category: "energy",
    });
  }

  if ((metrics?.moodSupport?.score ?? 0) < 60) {
    suggestions.push({
      title: "Support mood",
      reason: "Mood support needs more consistency.",
      action: "Use a short diary check-in and keep sleep more regular.",
      priority: "Medium",
      category: "mood",
    });
  }

  if (!suggestions.length) {
    suggestions.push({
      title: "Keep the current routine",
      reason: "Your latest pattern looks steady.",
      action: "Maintain the foods and habits that are already working.",
      priority: "Low",
      category: "maintenance",
    });
  }

  return {
    source: "fallback",
    headline: "Suggested next steps for today",
    calendarNote: buildStatusRecommendation(
      healthContext?.status ?? profile?.healthContext?.status ?? null,
    ),
    suggestions,
  };
};
