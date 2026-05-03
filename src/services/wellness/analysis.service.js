const ACTIVITY_MULTIPLIERS = {
  sedentary: 1.2,
  light: 1.375,
  moderate: 1.55,
  active: 1.725,
  very_active: 1.9,
};

const normalize = (value) =>
  String(value ?? "")
    .trim()
    .toLowerCase();
const normalizeSex = (value) => {
  const text = String(value ?? "")
    .trim()
    .toUpperCase();
  if (["FEMALE", "F", "WOMAN", "GIRL"].includes(text)) return "FEMALE";
  return "MALE";
};

const supportLevel = (score) => {
  if (score >= 80) return "High";
  if (score >= 50) return "Medium";
  return "Low";
};

export const estimateBmi = (profile) => {
  if (!profile?.heightCm || !profile?.weightKg) {
    return null;
  }

  const heightM = profile.heightCm / 100;
  if (heightM <= 0) {
    return null;
  }

  return Number((profile.weightKg / (heightM * heightM)).toFixed(1));
};

export const estimateCalorieTarget = (profile) => {
  if (!profile?.heightCm || !profile?.weightKg || !profile?.age) {
    return null;
  }

  const sex = normalizeSex(profile.sex);
  const activity =
    ACTIVITY_MULTIPLIERS[normalize(profile.activityLevel)] ?? 1.375;
  const base =
    10 * profile.weightKg +
    6.25 * profile.heightCm -
    5 * profile.age +
    (() => {
      switch (true) {
        case sex === "MALE":
          return 5;
        case sex === "FEMALE":
          return -161;
        default:
          return -78;
      }
    })();

  const goal = normalize(profile.healthGoal);
  let adjust = 0;
  switch (true) {
    case goal.includes("lose weight"):
      adjust -= 300;
      break;
    case goal.includes("gain weight"):
      adjust += 300;
      break;
    case goal.includes("build muscle"):
      adjust += 200;
      break;
    case goal.includes("improve energy"):
      adjust += 100;
      break;
    case goal.includes("reduce sugar"):
    case goal.includes("reduce sodium"):
      adjust -= 75;
      break;
    default:
      break;
  }

  return Math.max(1200, Math.round(base * activity + adjust));
};

export const estimateWaterTargetMl = (profile) => {
  if (!profile?.weightKg) {
    return 2000;
  }

  const baseline = Math.round(profile.weightKg * 30);
  const activity = normalize(profile.activityLevel);
  let bonus = 0;
  switch (activity) {
    case "moderate":
      bonus = 150;
      break;
    case "active":
    case "very active":
      bonus = 300;
      break;
    default:
      break;
  }
  return Math.max(1500, baseline + bonus);
};

const scoreHydration = ({
  diaries = [],
  waterLogs = [],
  waterTargetMl = 2000,
}) => {
  const diaryWater = diaries.reduce(
    (sum, diary) => sum + (diary.waterIntakeMl ?? 0),
    0,
  );
  const logWater = waterLogs.reduce((sum, log) => sum + (log.amountMl ?? 0), 0);
  const water = Math.max(diaryWater, logWater);
  if (!waterTargetMl) {
    return { score: 50, level: "Medium" };
  }

  const ratio = water / waterTargetMl;
  const score = Math.max(0, Math.min(100, Math.round(ratio * 100)));
  return { score, level: supportLevel(score) };
};

const scoreMood = (diaries = []) => {
  if (!diaries.length) {
    return { score: 50, level: "Medium" };
  }

  const goodTags = new Set(["happy", "calm", "focused"]);
  const badTags = new Set(["sad", "stressed", "tired", "anxious", "angry"]);
  const tagScore = diaries.reduce((sum, diary) => {
    const tag = normalize(diary.moodTag);
    switch (true) {
      case goodTags.has(tag):
        return sum + 2;
      case badTags.has(tag):
        return sum - 2;
      default:
        return sum;
    }
  }, 0);
  const stressPenalty =
    diaries.reduce((sum, diary) => sum + ((diary.stressLevel ?? 3) - 3), 0) * 5;
  const score = Math.max(0, Math.min(100, 60 + tagScore * 8 - stressPenalty));
  return { score, level: supportLevel(score) };
};

const scoreEnergy = ({ diaries = [], scans = [] }) => {
  const avgEnergy = diaries.length
    ? diaries.reduce((sum, diary) => sum + (diary.energyLevel ?? 3), 0) /
      diaries.length
    : 3;
  const avgProtein = scans.length
    ? scans.reduce((sum, scan) => sum + (scan.proteinGrams ?? 0), 0) /
      scans.length
    : 0;
  const avgSleep = diaries.length
    ? diaries.reduce((sum, diary) => sum + (diary.sleepHours ?? 7), 0) /
      diaries.length
    : 7;

  const score = Math.max(
    0,
    Math.min(
      100,
      Math.round(
        avgEnergy * 18 +
          Math.min(avgProtein, 20) * 1.5 +
          Math.min(avgSleep, 9) * 4,
      ),
    ),
  );

  return { score, level: supportLevel(score) };
};

const scoreHeartHealth = ({ scans = [] }) => {
  const avgSodium = scans.length
    ? scans.reduce((sum, scan) => sum + (scan.sodiumMg ?? 0), 0) / scans.length
    : 0;
  const avgFiber = scans.length
    ? scans.reduce((sum, scan) => sum + (scan.fiberGrams ?? 0), 0) /
      scans.length
    : 0;

  const score = Math.max(
    0,
    Math.min(100, Math.round(100 - avgSodium / 20 + avgFiber * 6)),
  );
  return { score, level: supportLevel(score) };
};

const scoreDigestion = ({ scans = [], diaries = [] }) => {
  const avgFiber = scans.length
    ? scans.reduce((sum, scan) => sum + (scan.fiberGrams ?? 0), 0) /
      scans.length
    : 0;
  const symptomsPenalty = diaries.reduce((sum, diary) => {
    const symptoms = Array.isArray(diary.symptoms) ? diary.symptoms : [];
    const digestiveSymptoms = symptoms.filter((item) =>
      /bloat|constip|stomach|indigestion|gas/i.test(String(item)),
    );
    return sum + digestiveSymptoms.length * 6;
  }, 0);

  const score = Math.max(
    0,
    Math.min(100, Math.round(50 + avgFiber * 10 - symptomsPenalty)),
  );
  return { score, level: supportLevel(score) };
};

export const buildProfileMetrics = (profile) => ({
  bmi: estimateBmi(profile),
  calorieTarget: estimateCalorieTarget(profile),
  waterTargetMl: estimateWaterTargetMl(profile),
});

export const buildDashboardMetrics = ({
  profile,
  scans = [],
  diaries = [],
  waterLogs = [],
}) => {
  const profileMetrics = buildProfileMetrics(profile);
  const hydration = scoreHydration({
    diaries,
    waterLogs,
    waterTargetMl: profileMetrics.waterTargetMl,
  });
  const moodSupport = scoreMood(diaries);
  const energySupport = scoreEnergy({ diaries, scans });
  const heartHealth = scoreHeartHealth({ scans });
  const digestion = scoreDigestion({ scans, diaries });
  const nutritionScore = scans.length
    ? Math.round(
        scans.reduce((sum, scan) => sum + scan.score, 0) / scans.length,
      )
    : 0;

  const latestWeight =
    diaries.find((diary) => diary.weightKg != null)?.weightKg ??
    profile?.weightKg ??
    null;
  const weightProgress =
    diaries.length > 1
      ? (() => {
          const weights = diaries
            .filter((entry) => entry.weightKg != null)
            .map((entry) => entry.weightKg);
          if (weights.length < 2) {
            return "No recent weight trend yet";
          }
          const delta = weights[0] - weights[weights.length - 1];
          if (Math.abs(delta) < 0.5) return "Weight is stable";
          return delta > 0
            ? `Up ${delta.toFixed(1)} kg`
            : `Down ${Math.abs(delta).toFixed(1)} kg`;
        })()
      : "Log more weights to see progress";

  const dailyWellnessScore = Math.round(
    nutritionScore * 0.35 +
      hydration.score * 0.15 +
      moodSupport.score * 0.15 +
      energySupport.score * 0.15 +
      heartHealth.score * 0.1 +
      digestion.score * 0.1,
  );

  return {
    dailyWellnessScore,
    nutrition: { score: nutritionScore, level: supportLevel(nutritionScore) },
    hydration,
    moodSupport,
    energySupport,
    heartHealth,
    digestion,
    bmiEstimate: profileMetrics.bmi,
    calorieTarget: profileMetrics.calorieTarget,
    waterTargetMl: profileMetrics.waterTargetMl,
    weightProgress,
    latestWeight,
  };
};

export const buildStatusRecommendation = (status) => {
  const value = normalize(status);
  switch (true) {
    case value === "on period":
    case value.includes("period"):
      return "Choose balanced meals, stay hydrated, and consider iron-rich foods like egg, fish, leafy vegetables, or beans.";
    case value === "pregnant":
    case value.includes("pregnant"):
      return "Follow doctor advice. The app can help flag foods that may need caution.";
    case value === "breastfeeding":
    case value.includes("breast"):
      return "Prioritize fluids, protein, and steady meals to support recovery and milk production.";
    case value === "recovering from surgery":
    case value === "post-surgery":
    case value.includes("surgery"):
      return "Prioritize doctor-approved foods, hydration, and protein-rich meals if allowed.";
    case value === "sick":
    case value === "ill":
    case value === "illness":
    case value === "recovering from illness":
    case value.includes("sick"):
    case value.includes("illness"):
    case value.includes("flu"):
    case value.includes("fever"):
    case value.includes("cold"):
      return "Keep meals light, stay hydrated, and follow medical advice if the illness needs treatment.";
    case value === "diarrhea":
    case value.includes("stomach"):
    case value.includes("nausea"):
    case value.includes("vomit"):
      return "Choose bland, gentle foods and focus on fluids; follow doctor advice if symptoms continue.";
    case value === "recovery":
    case value === "recovery from illness":
    case value.includes("recovering"):
      return "Use steady hydration, protein, and simple meals while the body recovers.";
    case value === "limited diet":
    case value.includes("limited"):
      return "Respect restrictions such as soft food only, low sodium, low sugar, low fat, or no spicy food.";
    case value === "soft food only":
    case value.includes("soft"):
      return "Use soft, easy-to-digest foods such as soup, oatmeal, mashed fruit, and steamed egg.";
    case value === "low sodium":
    case value.includes("low sodium"):
      return "Focus on fresh foods, herbs, and low-sodium alternatives while checking labels closely.";
    case value === "low sugar":
    case value.includes("low sugar"):
      return "Choose water, whole fruit, and unsweetened drinks to avoid hidden sugar spikes.";
    case value === "low fat":
    case value.includes("low fat"):
      return "Choose lean protein and lighter cooking methods like steaming or boiling.";
    case value === "no spicy food":
    case value.includes("no spicy"):
      return "Avoid chili-heavy meals and use mild, simple seasonings.";
    case value === "allergy restriction":
    case value.includes("allergy"):
      return "Avoid known allergens and check labels before every purchase.";
    case value === "doctor-advised diet":
    case value.includes("doctor"):
      return "Follow your doctor’s plan first; the app should only support it.";
    case value === "custom":
    case value.includes("custom"):
      return "Use your custom restriction as the main rule when judging meals.";
    default:
      return "Choose balanced meals, hydrate well, and keep portions steady.";
  }
};
