import KNN from "ml-knn";
import {
  buildDashboardMetrics,
  buildStatusRecommendation,
} from "./analysis.service.js";
import { buildWeeklyInsights } from "./insights.service.js";

const clamp = (value, min = 0, max = 1) =>
  Math.max(min, Math.min(max, Number(value) || 0));

const normalize = (value) =>
  String(value ?? "")
    .trim()
    .toLowerCase();

const encodeActivity = (value) => {
  switch (normalize(value)) {
    case "sedentary":
      return 0.1;
    case "light":
      return 0.3;
    case "moderate":
      return 0.55;
    case "active":
      return 0.75;
    case "very active":
      return 0.9;
    default:
      return 0.4;
  }
};

const encodeGoal = (goal = "") => {
  const text = normalize(goal);
  switch (true) {
    case text.includes("lose weight"):
      return 0.15;
    case text.includes("gain weight"):
      return 0.3;
    case text.includes("build muscle"):
      return 0.45;
    case text.includes("improve energy"):
      return 0.6;
    case text.includes("reduce sugar"):
    case text.includes("reduce sodium"):
      return 0.75;
    case text.includes("recover"):
    case text.includes("heal"):
      return 0.9;
    default:
      return 0.5;
  }
};

const countRestrictions = (profile = {}) =>
  [
    ...(Array.isArray(profile?.allergies) ? profile.allergies : []),
    ...(Array.isArray(profile?.dietRestrictions)
      ? profile.dietRestrictions
      : []),
    profile?.healthContext?.status,
    profile?.healthContext?.customRestriction,
  ].filter(Boolean).length;

const hasRecoveryContext = (profile = {}) =>
  /pregnan|recover|heal|surgery|ill|sick|period|breast/i.test(
    [
      profile?.healthContext?.status,
      profile?.healthGoal,
      profile?.healthContext?.customRestriction,
    ]
      .filter(Boolean)
      .map(normalize)
      .join(" "),
  )
    ? 1
    : 0;

const toMoneyRatio = (spent, budget) => {
  const safeBudget = Number(budget);
  if (!Number.isFinite(safeBudget) || safeBudget <= 0) {
    return 0.25;
  }
  return clamp(Number(spent) / safeBudget);
};

const buildFeatureVector = ({
  profile = {},
  metrics = {},
  waterLogs = [],
  mealTiming = {},
  budget = null,
}) => {
  const waterTotal = waterLogs.reduce(
    (sum, log) => sum + Number(log.amountMl ?? 0),
    0,
  );
  const waterTarget = metrics.waterTargetMl ?? 2000;
  const mealPeriods = Object.values(mealTiming).filter(
    (count) => Number(count) > 0,
  );
  const budgetSpent = Number(budget?.spent ?? budget?.amountSpent ?? 0);
  const budgetTarget =
    Number(budget?.weeklyBudget ?? budget?.planned ?? budget?.budgetAmount) ||
    0;

  return [
    clamp((metrics.nutrition?.score ?? 0) / 100),
    clamp((metrics.hydration?.score ?? 0) / 100),
    clamp((metrics.moodSupport?.score ?? 0) / 100),
    clamp((metrics.energySupport?.score ?? 0) / 100),
    clamp((metrics.heartHealth?.score ?? 0) / 100),
    clamp((metrics.digestion?.score ?? 0) / 100),
    clamp(waterTotal / Math.max(1, waterTarget)),
    toMoneyRatio(budgetSpent, budgetTarget),
    encodeActivity(profile.activityLevel),
    clamp(countRestrictions(profile) / 6),
    encodeGoal(profile.healthGoal),
    clamp((mealPeriods.length || 0) / 4),
    clamp((metrics.dailyWellnessScore ?? 0) / 100),
    hasRecoveryContext(profile),
  ];
};

const jitter = (vector, delta) =>
  vector.map((value, index) =>
    clamp(value + (index % 2 === 0 ? delta : -delta)),
  );

const buildTrainingData = () => {
  const templates = [
    {
      label: "balanced",
      values: [
        0.88, 0.82, 0.8, 0.8, 0.82, 0.8, 0.9, 0.22, 0.55, 0.08, 0.5, 0.7, 0.86,
        0,
      ],
    },
    {
      label: "hydration",
      values: [
        0.7, 0.28, 0.6, 0.58, 0.64, 0.58, 0.25, 0.22, 0.48, 0.12, 0.55, 0.4,
        0.5, 0,
      ],
    },
    {
      label: "nutrition",
      values: [
        0.38, 0.5, 0.54, 0.45, 0.4, 0.36, 0.5, 0.3, 0.45, 0.16, 0.6, 0.35, 0.42,
        0,
      ],
    },
    {
      label: "energy",
      values: [
        0.55, 0.58, 0.42, 0.28, 0.48, 0.46, 0.55, 0.24, 0.42, 0.12, 0.6, 0.25,
        0.36, 0,
      ],
    },
    {
      label: "budget",
      values: [
        0.72, 0.66, 0.66, 0.62, 0.66, 0.64, 0.72, 0.88, 0.48, 0.16, 0.48, 0.42,
        0.68, 0,
      ],
    },
    {
      label: "recovery",
      values: [
        0.58, 0.54, 0.56, 0.5, 0.54, 0.52, 0.56, 0.24, 0.36, 0.28, 0.9, 0.45,
        0.46, 1,
      ],
    },
  ];

  return templates.flatMap(({ label, values }) => [
    { features: values, label },
    { features: jitter(values, 0.02), label },
    { features: jitter(values, -0.02), label },
  ]);
};

const trainingData = buildTrainingData();
const model = new KNN(
  trainingData.map((item) => item.features),
  trainingData.map((item) => item.label),
  { k: 3 },
);

const labelDetails = {
  balanced: {
    summary:
      "Your profile and weekly logs look fairly steady, with no single issue dominating.",
    suggestions: [
      {
        title: "Keep the current routine",
        reason: "The strongest signals are broadly balanced.",
        action:
          "Keep the meals, water, and sleep habits that are already working.",
      },
      {
        title: "Maintain logging",
        reason: "More data will make the next week more precise.",
        action: "Keep adding meals, water, and diary entries.",
      },
    ],
  },
  hydration: {
    summary:
      "Hydration is the clearest machine-learned signal from your profile this week.",
    suggestions: [
      {
        title: "Drink on a schedule",
        reason: "Water coverage is below what your profile suggests.",
        action:
          "Add water between meals instead of waiting until you feel thirsty.",
      },
      {
        title: "Pair water with meals",
        reason: "That makes the habit easier to keep.",
        action: "Drink a glass before breakfast, lunch, and dinner.",
      },
    ],
  },
  nutrition: {
    summary:
      "Your food pattern points to nutrition support being the main gap this week.",
    suggestions: [
      {
        title: "Add protein and fiber",
        reason: "That usually lifts the weekly support score quickly.",
        action:
          "Include eggs, fish, tofu, beans, or vegetables in the next meal.",
      },
      {
        title: "Reduce high-sodium meals",
        reason:
          "The current profile and meal mix suggest a sodium-heavy pattern.",
        action: "Choose fresher or less processed meals when possible.",
      },
    ],
  },
  energy: {
    summary:
      "Energy support looks uneven, and the profile data points to habits that can be tightened.",
    suggestions: [
      {
        title: "Stabilize breakfast",
        reason:
          "Energy usually drops when the first meal is too light or skipped.",
        action: "Keep breakfast steady and avoid long gaps between meals.",
      },
      {
        title: "Protect sleep",
        reason:
          "Sleep and energy are connected in the current profile signals.",
        action: "Try for a more regular sleep window tonight.",
      },
    ],
  },
  budget: {
    summary:
      "Budget pressure is showing up alongside the profile data and weekly logs.",
    suggestions: [
      {
        title: "Use cheaper staples",
        reason:
          "The current weekly spend is running hotter than the budget target.",
        action: "Lean on rice, eggs, tofu, bananas, and home-cooked meals.",
      },
      {
        title: "Plan the next shop",
        reason: "Planning ahead reduces surprise spending.",
        action: "Pick 3-5 meals before the next grocery run.",
      },
    ],
  },
  recovery: {
    summary:
      "Your profile context suggests a recovery-focused week, so the model is weighting support differently.",
    suggestions: [
      {
        title: "Follow the profile context",
        reason: "Health status matters more than a generic weekly trend here.",
        action: "Use the status guidance and keep meals simple and steady.",
      },
      {
        title: "Keep fluids and protein steady",
        reason: "Those two habits usually help recovery most.",
        action: "Prioritize water, gentle meals, and enough protein.",
      },
    ],
  },
};

const focusLabels = {
  balanced: "Balanced week",
  hydration: "Hydration focus",
  nutrition: "Nutrition focus",
  energy: "Energy focus",
  budget: "Budget focus",
  recovery: "Recovery focus",
};

const featureLabels = [
  "Nutrition score",
  "Hydration score",
  "Mood support",
  "Energy support",
  "Heart-health support",
  "Digestion support",
  "Water target coverage",
  "Budget usage",
  "Activity level",
  "Restriction load",
  "Goal alignment",
  "Meal timing coverage",
  "Daily wellness score",
  "Recovery context",
];

const euclideanDistance = (a = [], b = []) =>
  Math.sqrt(
    a.reduce((sum, value, index) => {
      const diff = Number(value ?? 0) - Number(b[index] ?? 0);
      return sum + diff * diff;
    }, 0),
  );

const buildModelReadout = (features = [], prediction = "balanced") => {
  const neighbors = trainingData
    .map((item) => ({
      label: item.label,
      distance: euclideanDistance(features, item.features),
    }))
    .sort((a, b) => a.distance - b.distance)
    .slice(0, 6);
  const closest = neighbors[0]?.distance ?? 1;
  const secondDifferent =
    neighbors.find((item) => item.label !== prediction)?.distance ??
    closest + 0.3;
  const margin = Math.max(0, secondDifferent - closest);
  const confidence = clamp(0.45 + margin * 1.5, 0.45, 0.94);
  const driverIndexes = features
    .map((value, index) => ({
      index,
      label: featureLabels[index],
      value,
      distanceFromSteady: Math.abs(Number(value) - 0.72),
    }))
    .sort((a, b) => b.distanceFromSteady - a.distanceFromSteady)
    .slice(0, 5);

  return {
    algorithm: "K-nearest neighbors",
    model: "local-weekly-health-knn",
    prediction,
    predictionLabel: focusLabels[prediction] ?? "Weekly focus",
    confidence: Number(confidence.toFixed(2)),
    confidenceLabel:
      confidence >= 0.8 ? "High" : confidence >= 0.62 ? "Medium" : "Low",
    nearestNeighbors: neighbors.map((item) => ({
      label: focusLabels[item.label] ?? item.label,
      distance: Number(item.distance.toFixed(3)),
    })),
    signals: features.map((value, index) => ({
      label: featureLabels[index],
      value: Number(value.toFixed(2)),
      percent: Math.round(value * 100),
    })),
    drivers: driverIndexes.map((item) => ({
      label: item.label,
      value: Number(item.value.toFixed(2)),
      percent: Math.round(item.value * 100),
      direction: item.value >= 0.72 ? "strong" : "needs attention",
    })),
  };
};

const buildSupplementaryInsights = ({
  profile,
  metrics,
  waterLogs,
  mealTiming,
  budget,
  contextReasons,
}) => {
  const waterTotal = waterLogs.reduce(
    (sum, log) => sum + Number(log.amountMl ?? 0),
    0,
  );
  const waterTarget = metrics.waterTargetMl ?? 2000;
  const budgetSpent = Number(budget?.spent ?? budget?.amountSpent ?? 0);
  const budgetCurrency = budget?.currency ?? budget?.budgetCurrency ?? "PHP";
  const mealTimingText = Object.entries(mealTiming ?? {})
    .filter(([, count]) => Number(count) > 0)
    .map(([period, count]) => `${period} ${count}`)
    .join(", ");
  const budgetText = Number.isFinite(budgetSpent)
    ? `Budget: ${budgetCurrency} ${budgetSpent.toFixed(0)} spent.`
    : null;

  return [
    profile?.healthGoal ? `Profile goal: ${profile.healthGoal}.` : null,
    profile?.activityLevel ? `Activity level: ${profile.activityLevel}.` : null,
    profile?.healthContext?.status
      ? `Health context: ${profile.healthContext.status}.`
      : null,
    `Daily wellness score is ${metrics.dailyWellnessScore}/100.`,
    `Nutrition is ${metrics.nutrition.level}; hydration is ${metrics.hydration.level}; energy is ${metrics.energySupport.level}.`,
    `Water logged: ${waterTotal.toFixed(0)}ml of ${waterTarget.toFixed(0)}ml.`,
    budgetText,
    mealTimingText ? `Meal timing this week: ${mealTimingText}.` : null,
    contextReasons[0] ?? null,
  ].filter(Boolean);
};

export const buildWeeklyMlInsights = ({
  profile,
  metrics,
  scans = [],
  diaries = [],
  summaries = [],
  waterLogs = [],
  mealTiming = {},
  budget = null,
  contextReasons = [],
}) => {
  const resolvedMetrics =
    metrics ??
    buildDashboardMetrics({
      profile,
      scans,
      diaries,
      waterLogs,
    });
  const features = buildFeatureVector({
    profile,
    metrics: resolvedMetrics,
    waterLogs,
    mealTiming,
    budget,
  });
  const prediction = model.predict([features])[0] ?? "balanced";
  const ml = buildModelReadout(features, prediction);
  const details = labelDetails[prediction] ?? labelDetails.balanced;
  const insights = [
    `${focusLabels[prediction] ?? "Weekly insight"}: ${details.summary}`,
    ...buildWeeklyInsights({ scans, diaries, summaries }),
    ...buildSupplementaryInsights({
      profile,
      metrics: resolvedMetrics,
      waterLogs,
      mealTiming,
      budget,
      contextReasons,
    }),
  ].filter(Boolean);

  return {
    source: "local-ml",
    model: "knn",
    focus: prediction,
    summary: details.summary,
    ml,
    insights,
    suggestions: details.suggestions,
    contextHint: buildStatusRecommendation(
      profile?.healthContext?.status ?? profile?.healthGoal ?? null,
    ),
  };
};
