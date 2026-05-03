import {
  buildDashboardMetrics,
  buildStatusRecommendation,
} from "../wellness/analysis.service.js";
import {
  scoreFood,
  buildDiaryReflection,
  summarizeDay,
} from "../wellness/wellness.service.js";
import { searchOpenFoodFacts } from "../nutrition/food-api.service.js";
import { callGemini, buildProfileContext } from "./ai-core.service.js";
import {
  estimateMealFromText,
  buildBudgetMealSuggestions,
  buildGroceryList,
  buildWellnessReminders,
  inferFoodType,
} from "../nutrition/meal-knowledge.service.js";
import { buildBudgetContext } from "../nutrition/budget.service.js";
import {
  fallbackScanAnalysis,
  fallbackDiaryAnalysis,
  fallbackWeeklyAnalysis,
  fallbackMealAnalysis,
  fallbackManualMealAnalysis,
  fallbackPhotoMealAnalysis,
  fallbackSuggestionBundle,
} from "./ai-fallbacks.service.js";

export const analyzeScan = async ({
  profile,
  healthContext,
  productName,
  nutrition,
  scoreResult,
}) => {
  const profileContext = buildProfileContext(profile, healthContext);
  const payload = {
    profile: profileContext,
    healthContext,
    productName,
    nutrition,
    scoreResult,
  };

  try {
    const geminiResult = await callGemini("scan", payload);
    if (geminiResult) {
      return {
        ...geminiResult,
        foodType:
          geminiResult.foodType ?? inferFoodType({ mealText: productName }),
      };
    }
    return fallbackScanAnalysis({
      profile,
      healthContext,
      productName,
      nutrition,
      scoreResult,
      profileContext,
    });
  } catch {
    return fallbackScanAnalysis({
      profile,
      healthContext,
      productName,
      nutrition,
      scoreResult,
      profileContext,
    });
  }
};

export const analyzeDiary = async ({
  profile,
  healthContext,
  entry,
  journalContext,
  moodTag,
  energyLevel,
  stressLevel,
  sleepHours,
  waterIntakeMl,
  activityMinutes,
  scanSignals,
}) => {
  const profileContext = buildProfileContext(profile, healthContext);
  const journalText = journalContext?.contextText ?? entry;
  const payload = {
    profile: profileContext,
    healthContext,
    entry: journalText,
    journalContext,
    moodTag,
    energyLevel,
    stressLevel,
    sleepHours,
    waterIntakeMl,
    activityMinutes,
    scanSignals,
  };

  try {
    return (
      (await callGemini("diary", payload)) ??
      fallbackDiaryAnalysis({
        entry,
        moodTag,
        energyLevel,
        stressLevel,
        sleepHours,
        waterIntakeMl,
        activityMinutes,
        scanSignals,
      })
    );
  } catch {
    return fallbackDiaryAnalysis({
      entry,
      moodTag,
      energyLevel,
      stressLevel,
      sleepHours,
      waterIntakeMl,
      activityMinutes,
      scanSignals,
    });
  }
};

export const analyzeWeekly = async ({ profile, scans, diaries, summaries }) => {
  const payload = {
    profile: buildProfileContext(profile),
    scans,
    diaries,
    summaries,
  };

  try {
    return (
      (await callGemini("weekly", payload)) ??
      fallbackWeeklyAnalysis({ profile, scans, diaries, summaries })
    );
  } catch {
    return fallbackWeeklyAnalysis({ profile, scans, diaries, summaries });
  }
};

export const analyzeMeal = async ({ profile, healthContext, mealText }) => {
  return analyzeManualMeal({
    profile,
    healthContext,
    mealText,
    lookupPackagedFood: true,
  });
};

const normalizeNutrition = (nutrition = {}) => ({
  calories: nutrition.calories ?? null,
  sugarGrams: nutrition.sugarGrams ?? null,
  sodiumMg: nutrition.sodiumMg ?? null,
  fatGrams: nutrition.fatGrams ?? null,
  proteinGrams: nutrition.proteinGrams ?? null,
  fiberGrams: nutrition.fiberGrams ?? null,
});

const chooseNutrition = (primary = {}, secondary = {}) => ({
  calories: primary.calories ?? secondary.calories ?? null,
  sugarGrams: primary.sugarGrams ?? secondary.sugarGrams ?? null,
  sodiumMg: primary.sodiumMg ?? secondary.sodiumMg ?? null,
  fatGrams: primary.fatGrams ?? secondary.fatGrams ?? null,
  proteinGrams: primary.proteinGrams ?? secondary.proteinGrams ?? null,
  fiberGrams: primary.fiberGrams ?? secondary.fiberGrams ?? null,
});

const buildMealAnalysisBase = ({
  profile,
  healthContext,
  mealText,
  localEstimate,
  nutrition,
  scoreResult,
  source,
  extra = {},
  profileContext,
}) => ({
  source,
  kind: extra.kind ?? "meal",
  mealName: extra.mealName ?? localEstimate?.mealName ?? mealText,
  foodType: extra.foodType ?? localEstimate?.foodType ?? null,
  summary:
    extra.summary ??
    `${extra.mealName ?? localEstimate?.mealName ?? mealText} scores ${scoreResult.score}/100 and is ${scoreResult.supportLevel} support.`,
  patternSummary:
    extra.patternSummary ??
    profileContext?.signals?.[0] ??
    "Your profile suggests a balanced eating pattern.",
  nutrition: normalizeNutrition(nutrition ?? localEstimate?.nutrition ?? {}),
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
  recognizedFoods:
    extra.recognizedFoods ??
    localEstimate?.matchedFoods?.map((item) => item.name) ??
    [],
  confidence: extra.confidence ?? null,
  wellnessReminders: extra.wellnessReminders ?? [],
  budgetContext:
    extra.budgetContext ??
    buildBudgetContext({
      profile,
      amountSpent: localEstimate?.priceEstimatePhp ?? 0,
      fallbackCurrency:
        profile?.budgetCurrency ?? profile?.incomeCurrency ?? "PHP",
    }),
});

export const analyzeManualMeal = async ({
  profile,
  healthContext,
  mealText,
  lookupPackagedFood = false,
  budgetMode = false,
}) => {
  const profileContext = buildProfileContext(profile, healthContext);
  const localEstimate = estimateMealFromText({ mealText, profile, budgetMode });
  const foodData = lookupPackagedFood
    ? await searchOpenFoodFacts(mealText)
    : null;
  const nutrition = chooseNutrition(
    foodData?.nutrition ?? {},
    localEstimate?.nutrition ?? {},
  );
  const budgetContext = buildBudgetContext({
    profile,
    amountSpent: localEstimate?.priceEstimatePhp ?? 0,
    fallbackCurrency:
      profile?.budgetCurrency ?? profile?.incomeCurrency ?? "PHP",
  });
  const scoreResult = scoreFood({
    nutrition,
    productName: foodData?.productName ?? localEstimate?.mealName ?? mealText,
    profile,
    healthStatus: healthContext?.status ?? null,
  });

  const payload = {
    profile: profileContext,
    healthContext,
    mealText,
    foodData,
    scoreResult,
    localEstimate,
    budgetMode,
    mealMode: "manual",
  };

  try {
    const geminiResult = await callGemini("manualMeal", payload);
    if (geminiResult) {
      const mergedNutrition = chooseNutrition(
        geminiResult.nutrition ?? {},
        nutrition,
      );
      const mergedScore = scoreFood({
        nutrition: mergedNutrition,
        productName:
          geminiResult.mealName ??
          foodData?.productName ??
          localEstimate?.mealName ??
          mealText,
        profile,
        healthStatus: healthContext?.status ?? null,
      });

      return buildMealAnalysisBase({
        profile,
        healthContext,
        mealText,
        localEstimate: { ...localEstimate, nutrition: mergedNutrition },
        nutrition: mergedNutrition,
        scoreResult: mergedScore,
        source: foodData ? `${foodData.source}+gemini` : "gemini",
        profileContext,
        extra: {
          kind: "manual-meal",
          ...geminiResult,
          profileSignals: geminiResult.profileSignals ?? profileContext.signals,
          budgetContext,
          foodType: geminiResult.foodType ?? localEstimate.foodType,
          warnings: [
            ...(geminiResult.warnings ?? geminiResult.flags ?? []),
            ...(budgetContext.overBudget
              ? [
                  `Estimated cost is over the current budget by PHP ${Math.abs(budgetContext.remainingToday ?? 0).toFixed(2)}`,
                ]
              : []),
          ],
          wellnessReminders: buildWellnessReminders({
            profile,
            healthContext,
            nutrition: mergedNutrition,
            waterTargetMl: budgetContext.dailyBudget ?? 100,
            waterTotalMl: 0,
          }),
        },
      });
    }
  } catch {
    // fall through to fallback below
  }

  return fallbackManualMealAnalysis({
    profile,
    healthContext,
    mealText,
    foodData,
    scoreResult,
    source: foodData ? foodData.source : "fallback",
    profileContext,
    localEstimate,
    extra: {
      budgetContext,
      foodType: localEstimate.foodType,
      warnings: [
        ...(localEstimate?.warnings ?? []),
        ...(budgetContext.overBudget
          ? [
              `Estimated cost is over the current budget by PHP ${Math.abs(budgetContext.remainingToday ?? 0).toFixed(2)}`,
            ]
          : []),
      ],
    },
  });
};

export const analyzePhotoMeal = async ({
  profile,
  healthContext,
  mealText,
  image,
  ocrText,
  budgetMode = false,
}) => {
  const profileContext = buildProfileContext(profile, healthContext);
  const localEstimate = estimateMealFromText({
    mealText: mealText || ocrText || "photo meal",
    profile,
    budgetMode,
  });
  const nutrition = localEstimate?.nutrition ?? {};
  const budgetContext = buildBudgetContext({
    profile,
    amountSpent: localEstimate?.priceEstimatePhp ?? 0,
    fallbackCurrency:
      profile?.budgetCurrency ?? profile?.incomeCurrency ?? "PHP",
  });
  const scoreResult = scoreFood({
    nutrition,
    productName: localEstimate?.mealName ?? mealText ?? "Food photo",
    profile,
    healthStatus: healthContext?.status ?? null,
  });

  const payload = {
    profile: profileContext,
    healthContext,
    mealText: mealText ?? ocrText ?? "",
    ocrText,
    localEstimate,
    scoreResult,
    budgetMode,
    mealMode: "photo",
  };

  try {
    const geminiResult = await callGemini("photoMeal", payload, {
      image: image
        ? {
            mimeType: image.mimetype,
            data: image.buffer.toString("base64"),
          }
        : null,
    });

    if (geminiResult) {
      const mergedNutrition = chooseNutrition(
        geminiResult.nutrition ?? {},
        nutrition,
      );
      const mergedScore = scoreFood({
        nutrition: mergedNutrition,
        productName:
          geminiResult.mealName ??
          localEstimate?.mealName ??
          mealText ??
          "Food photo",
        profile,
        healthStatus: healthContext?.status ?? null,
      });

      return buildMealAnalysisBase({
        profile,
        healthContext,
        mealText: mealText ?? ocrText ?? "Food photo",
        localEstimate: { ...localEstimate, nutrition: mergedNutrition },
        nutrition: mergedNutrition,
        scoreResult: mergedScore,
        source: "photo+gemini",
        profileContext,
        extra: {
          kind: "photo-meal",
          ...geminiResult,
          profileSignals: geminiResult.profileSignals ?? profileContext.signals,
          recognizedFoods:
            geminiResult.recognizedFoods ??
            localEstimate.matchedFoods.map((item) => item.name),
          budgetContext,
          foodType: geminiResult.foodType ?? localEstimate.foodType,
          warnings: [
            ...(geminiResult.warnings ?? geminiResult.flags ?? []),
            ...(budgetContext.overBudget
              ? [
                  `Estimated cost is over the current budget by PHP ${Math.abs(budgetContext.remainingToday ?? 0).toFixed(2)}`,
                ]
              : []),
          ],
          wellnessReminders: buildWellnessReminders({
            profile,
            healthContext,
            nutrition: mergedNutrition,
            waterTargetMl: budgetContext.dailyBudget ?? 100,
            waterTotalMl: 0,
          }),
        },
      });
    }
  } catch {
    // fall through to fallback below
  }

  return fallbackPhotoMealAnalysis({
    profile,
    healthContext,
    mealText: mealText ?? ocrText ?? "Food photo",
    scoreResult,
    source: "fallback",
    profileContext,
    localEstimate,
    recognizedFoods: localEstimate.matchedFoods.map((item) => item.name),
    confidence: localEstimate.matchedFoods.length ? "Medium" : "Low",
    extra: {
      budgetContext,
      foodType: localEstimate.foodType,
      warnings: [
        ...(localEstimate?.warnings ?? []),
        ...(budgetContext.overBudget
          ? [
              `Estimated cost is over the current budget by PHP ${Math.abs(budgetContext.remainingToday ?? 0).toFixed(2)}`,
            ]
          : []),
      ],
    },
  });
};

export const generateBudgetSuggestions = async ({
  profile,
  healthContext,
  maxPhp = 100,
  currency = null,
}) => {
  const profileContext = buildProfileContext(profile, healthContext);
  const resolvedCurrency =
    currency ?? profile?.budgetCurrency ?? profile?.incomeCurrency ?? "PHP";
  const localMeals = buildBudgetMealSuggestions({
    profile,
    maxPhp,
    currency: resolvedCurrency,
  });
  const budgetContext = buildBudgetContext({
    profile,
    amountSpent: 0,
    fallbackDailyBudget: maxPhp,
    fallbackCurrency: resolvedCurrency,
  });
  const payload = {
    profile: profileContext,
    healthContext,
    maxPhp,
    currency: resolvedCurrency,
    localMeals,
    budgetContext,
  };

  try {
    const geminiResult = await callGemini("budget", payload);
    if (geminiResult?.meals?.length) {
      return {
        source: "gemini",
        headline: geminiResult.headline ?? "Affordable meal ideas",
        budgetNote:
          geminiResult.budgetNote ??
          `Healthy meal ideas under ${resolvedCurrency} ${maxPhp}.`,
        meals: geminiResult.meals,
        groceryList:
          geminiResult.groceryList ??
          buildGroceryList({ budgetSuggestions: localMeals }),
        localMeals,
        budgetContext,
        profileSignals: profileContext.signals,
      };
    }
  } catch {
    // fall through to local budget suggestions
  }

  return {
    source: "fallback",
    headline: "Affordable meal ideas",
    budgetNote: `Healthy meal ideas under ${resolvedCurrency} ${maxPhp}.`,
    meals: localMeals,
    groceryList: buildGroceryList({ budgetSuggestions: localMeals }),
    localMeals,
    budgetContext,
    profileSignals: profileContext.signals,
  };
};

export const generateWorkoutSuggestions = async ({
  profile,
  healthContext,
  maxMinutes = 45,
  equipment = [],
  source = "manual",
}) => {
  const profileContext = buildProfileContext(profile, healthContext);
  const payload = {
    profile: profileContext,
    healthContext,
    maxMinutes,
    equipment,
    source,
  };

  try {
    const geminiResult = await callGemini("workout", payload);
    if (geminiResult?.workouts?.length) {
      return {
        source: "gemini",
        headline: geminiResult.headline ?? "Workout ideas",
        sessionNote:
          geminiResult.sessionNote ??
          "Pick one session that matches your energy today.",
        workouts: geminiResult.workouts,
        calendarNote: geminiResult.calendarNote ?? "Try one session this week.",
        profileSignals: profileContext.signals,
      };
    }
  } catch {
    // fall through to fallback
  }

  const durationMinutes = Math.max(15, Math.min(120, Number(maxMinutes) || 45));
  return {
    source: "fallback",
    headline: "Workout ideas",
    sessionNote: "A simple session you can do at home or in the gym.",
    workouts: [
      {
        title: "Brisk walk and bodyweight circuit",
        workoutType: "cardio",
        durationMinutes,
        intensity: "Medium",
        equipment: equipment.slice(0, 3),
        steps: [
          "Warm up",
          "Walk or jog",
          "Bodyweight squats",
          "Push-ups",
          "Cool down",
        ],
        why: "Easy to start and works for most profiles.",
      },
    ],
    calendarNote: "Do one session this week and build from there.",
    profileSignals: profileContext.signals,
  };
};

export const generateWellnessSuggestions = async ({
  profile,
  healthContext,
  metrics,
  scans = [],
  diaries = [],
  summaries = [],
}) => {
  const profileContext = buildProfileContext(profile, healthContext);
  const payload = {
    profile: profileContext,
    healthContext,
    metrics,
    patterns: {
      scans: scans.slice(0, 10),
      diaries: diaries.slice(0, 10),
      summaries: summaries.slice(0, 7),
    },
  };

  try {
    const geminiResult = await callGemini("suggestions", payload);
    if (geminiResult?.suggestions?.length) {
      return {
        source: "gemini",
        headline: geminiResult.headline ?? "Suggested next steps for today",
        calendarNote:
          geminiResult.calendarNote ??
          buildStatusRecommendation(
            healthContext?.status ?? profile?.healthContext?.status ?? null,
          ),
        suggestions: geminiResult.suggestions,
        profileSignals: profileContext.signals,
      };
    }
  } catch {
    // fall through to fallback
  }

  const fallback = fallbackSuggestionBundle({
    profile,
    healthContext,
    metrics,
  });
  return {
    ...fallback,
    profileSignals: profileContext.signals,
  };
};
