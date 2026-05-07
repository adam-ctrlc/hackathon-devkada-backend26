import { predictMealSupportLevel } from "../nutrition/meal-classifier.service.js";

const supportLevelFromScore = (score) => {
  if (score >= 80) {
    return "High";
  }

  if (score >= 50) {
    return "Medium";
  }

  return "Low";
};

const clampScore = (score) => Math.max(0, Math.min(100, Math.round(score)));

const normalizeText = (value) =>
  String(value ?? "")
    .trim()
    .toLowerCase();

const buildAlternatives = (productName, restrictions = []) => {
  const loweredRestrictions = restrictions.map(normalizeText);

  if (loweredRestrictions.some((item) => item.includes("low sodium"))) {
    return ["Fresh fruit", "Boiled egg", "Unsalted nuts", "Plain rice"];
  }

  if (loweredRestrictions.some((item) => item.includes("low sugar"))) {
    return ["Water", "Unsweetened tea", "Greek yogurt", "Banana"];
  }

  if (loweredRestrictions.some((item) => item.includes("soft food"))) {
    return ["Soup", "Oatmeal", "Mashed banana", "Steamed egg"];
  }

  if (/soda|soft drink|cola|juice/.test(normalizeText(productName))) {
    return ["Water", "Unsweetened tea", "Infused water", "Sparkling water"];
  }

  if (
    /instant noodles|cup noodles|ramen|noodle/.test(normalizeText(productName))
  ) {
    return [
      "Half seasoning + egg",
      "Instant noodles with cabbage",
      "Add malunggay",
      "Soup with vegetables",
    ];
  }

  if (/chips|crisps|snack/.test(normalizeText(productName))) {
    return ["Banana", "Unsalted nuts", "Crackers", "Yogurt"];
  }

  return ["Water", "Fruit", "Boiled egg", "Plain rice"];
};

const describeImpact = (score) => {
  if (score >= 80) {
    return "Supports your wellness goals well.";
  }

  if (score >= 50) {
    return "Works best in moderation.";
  }

  return "Lower support for your wellness goals right now.";
};

const contextAdjustments = (nutrition, profile, healthStatus) => {
  const notes = [];
  let delta = 0;

  if ((nutrition.sodiumMg ?? 0) > 600) {
    delta -= 15;
    notes.push("High sodium");
  }

  if ((nutrition.sodiumMg ?? 0) > 1200) {
    delta -= 10;
  }

  if ((nutrition.sugarGrams ?? 0) > 20) {
    delta -= 15;
    notes.push("High sugar");
  }

  if ((nutrition.proteinGrams ?? 0) < 10) {
    delta -= 10;
    notes.push("Low protein");
  }

  if ((nutrition.fiberGrams ?? 0) < 3) {
    delta -= 8;
    notes.push("Low fiber");
  }

  if ((nutrition.calories ?? 0) > 700) {
    delta -= 5;
    notes.push("High calories");
  }

  const restrictions = [
    ...(profile?.restrictions ? [profile.restrictions] : []),
    ...(Array.isArray(profile?.allergies) ? profile.allergies : []),
    ...(healthStatus ? [healthStatus] : []),
  ];

  const normalized = restrictions.map(normalizeText);

  if (
    normalized.some((item) => item.includes("low sodium")) &&
    (nutrition.sodiumMg ?? 0) > 300
  ) {
    delta -= 20;
    notes.push("Too much sodium for low-sodium mode");
  }

  if (
    normalized.some((item) => item.includes("low sugar")) &&
    (nutrition.sugarGrams ?? 0) > 10
  ) {
    delta -= 15;
    notes.push("Too much sugar for low-sugar mode");
  }

  if (
    normalized.some((item) => item.includes("soft food")) &&
    (nutrition.fiberGrams ?? 0) > 5
  ) {
    delta -= 8;
    notes.push("May be too rough for soft-food mode");
  }

  if (normalized.some((item) => item.includes("pregnant"))) {
    notes.push(
      "Pregnancy context selected; check doctor guidance for specific foods.",
    );
  }

  if (normalized.some((item) => item.includes("post-surgery"))) {
    notes.push(
      "Post-surgery context selected; follow doctor-approved foods first.",
    );
  }

  return { delta, notes };
};

export const scoreFood = ({
  nutrition = {},
  productName = "Food item",
  profile,
  healthStatus,
}) => {
  const supportLevel = predictMealSupportLevel({
    nutrition,
    profile,
    healthStatus,
    productName,
  });
  const baseScore = (() => {
    switch (supportLevel) {
      case "High":
        return 84;
      case "Medium":
        return 62;
      default:
        return 38;
    }
  })();
  const qualityDelta =
    Math.min((nutrition.proteinGrams ?? 0) * 1.2, 14) +
    Math.min((nutrition.fiberGrams ?? 0) * 2.5, 12) -
    Math.min((nutrition.sugarGrams ?? 0) * 0.9, 22) -
    Math.min((nutrition.sodiumMg ?? 0) / 80, 18) -
    Math.max(0, ((nutrition.calories ?? 0) - 350) / 60);
  const { delta, notes } = contextAdjustments(nutrition, profile, healthStatus);
  const score = clampScore(baseScore + qualityDelta + delta);
  const restrictions = [
    ...(profile?.restrictions ? [profile.restrictions] : []),
    ...(Array.isArray(profile?.allergies) ? profile.allergies : []),
  ];

  return {
    score,
    supportLevel,
    wellnessImpact: describeImpact(score),
    betterAlternatives: buildAlternatives(productName, restrictions),
    notes,
  };
};

export const buildDiaryReflection = ({
  entry,
  moodTag,
  energyLevel,
  stressLevel,
  sleepHours,
  waterIntakeMl,
  activityMinutes,
  scanSignals = [],
}) => {
  const pieces = [];
  const normalizedSignals = (Array.isArray(scanSignals) ? scanSignals : [])
    .map((signal) => {
      if (signal && typeof signal === "object") {
        return String(signal.label ?? signal.detail ?? signal.title ?? "")
          .trim()
          .toLowerCase();
      }
      return String(signal ?? "")
        .trim()
        .toLowerCase();
    })
    .filter(Boolean);

  if (moodTag) {
    pieces.push(`Your mood today was ${moodTag}.`);
  }

  if (energyLevel <= 3) {
    pieces.push("Energy looks low, so regular meals and water may help.");
  }

  if (stressLevel >= 4) {
    pieces.push(
      "Stress is high, so a smaller meal, rest, or a short walk may help.",
    );
  }

  if ((sleepHours ?? 7) < 6) {
    pieces.push("Sleep looks short, and that can affect energy and appetite.");
  }

  if ((waterIntakeMl ?? 0) < 1500) {
    pieces.push(
      "Water intake looks low, so hydrating more may help with focus and digestion.",
    );
  }

  if ((activityMinutes ?? 0) >= 30) {
    pieces.push("Your activity supports energy and digestion.");
  }

  if (normalizedSignals.some((signal) => signal.includes("high sodium"))) {
    pieces.push("Some recent food choices were high in sodium.");
  }

  if (normalizedSignals.some((signal) => signal.includes("low protein"))) {
    pieces.push(
      "Adding protein like egg, tofu, tuna, or chicken could support recovery and energy.",
    );
  }

  if (entry) {
    pieces.push(`Journal note: ${entry}`);
  }

  return pieces.join(" ");
};

export const summarizeDay = ({ scans = [], diaries = [], profile }) => {
  const latestScan = scans[0] ?? null;
  const averageScanScore = scans.length
    ? Math.round(
        scans.reduce((sum, scan) => sum + scan.score, 0) / scans.length,
      )
    : 0;
  const averageEnergy = diaries.length
    ? diaries.reduce((sum, diary) => sum + (diary.energyLevel ?? 3), 0) /
      diaries.length
    : 3;
  const averageStress = diaries.length
    ? diaries.reduce((sum, diary) => sum + (diary.stressLevel ?? 3), 0) /
      diaries.length
    : 3;

  let score = 70;
  score += Math.round((averageScanScore - 70) * 0.6);
  score += Math.round((averageEnergy - 3) * 6);
  score -= Math.round((averageStress - 3) * 5);

  if (
    profile?.healthGoal &&
    normalizeText(profile.healthGoal).includes("reduce sugar")
  ) {
    score -= scans.some((scan) => (scan.nutrition?.sugarGrams ?? 0) > 15)
      ? 5
      : 0;
  }

  score = clampScore(score);

  const suggestions = [];

  if ((latestScan?.nutrition?.proteinGrams ?? 0) < 10) {
    suggestions.push("Add protein tomorrow, like egg, tofu, fish, or chicken.");
  }

  if (scans.some((scan) => (scan.nutrition?.sodiumMg ?? 0) > 600)) {
    suggestions.push("Drink more water and reduce processed or instant foods.");
  }

  if (diaries.some((diary) => (diary.energyLevel ?? 3) <= 3)) {
    suggestions.push(
      "Try a steadier breakfast and keep caffeine balanced with food.",
    );
  }

  const supportLevel = supportLevelFromScore(score);

  return {
    score,
    supportLevel,
    highlights: [
      latestScan ? `Latest scan: ${latestScan.productName}` : "No scans yet",
      diaries.length
        ? `Diary entries: ${diaries.length}`
        : "No diary entries yet",
    ],
    suggestions,
  };
};
