const toDateKey = (value) => new Date(value).toISOString().slice(0, 10);

const normalizeText = (value) =>
  String(value ?? "")
    .trim()
    .toLowerCase();

export const buildEngagementMetrics = ({
  scans = [],
  mealLogs = [],
  waterLogs = [],
  diaries = [],
} = {}) => {
  const byDate = new Map();

  const addDay = (dateValue, patch) => {
    const key = toDateKey(dateValue);
    const current = byDate.get(key) ?? {
      scoreTotal: 0,
      scoreCount: 0,
      waterMl: 0,
      hasLowSodium: false,
      hasHighSodium: false,
      hasBalancedMeal: false,
      hasSoftDrink: false,
    };

    if (typeof patch.score === "number") {
      current.scoreTotal += patch.score;
      current.scoreCount += 1;
    }

    if (typeof patch.waterMl === "number") {
      current.waterMl += patch.waterMl;
    }

    current.hasLowSodium ||= patch.hasLowSodium ?? false;
    current.hasHighSodium ||= patch.hasHighSodium ?? false;
    current.hasBalancedMeal ||= patch.hasBalancedMeal ?? false;
    current.hasSoftDrink ||= patch.hasSoftDrink ?? false;

    byDate.set(key, current);
  };

  for (const scan of scans) {
    addDay(scan.createdAt, {
      score: Number(scan.score) || 0,
      hasLowSodium: (scan.sodiumMg ?? 0) <= 300,
      hasHighSodium: (scan.sodiumMg ?? 0) > 600,
      hasBalancedMeal:
        (scan.proteinGrams ?? 0) >= 10 && (scan.fiberGrams ?? 0) >= 3,
      hasSoftDrink: /soda|soft drink|cola|juice/i.test(
        normalizeText(scan.productName),
      ),
    });
  }

  for (const meal of mealLogs) {
    addDay(meal.createdAt, {
      score: Number(meal.score) || 0,
      hasLowSodium: (meal.sodiumMg ?? 0) <= 300,
      hasHighSodium: (meal.sodiumMg ?? 0) > 600,
      hasBalancedMeal:
        (meal.proteinGrams ?? 0) >= 10 && (meal.fiberGrams ?? 0) >= 3,
      hasSoftDrink: /soda|soft drink|cola|juice/i.test(
        normalizeText(meal.rawText ?? meal.matchedProductName),
      ),
    });
  }

  for (const water of waterLogs) {
    addDay(water.createdAt, {
      waterMl: Number(water.amountMl) || 0,
    });
  }

  for (const diary of diaries) {
    addDay(diary.createdAt, {
      waterMl: Number(diary.waterIntakeMl) || 0,
    });
  }

  const entries = [...byDate.entries()].sort(([a], [b]) => (a < b ? -1 : 1));
  const series = entries.map(([date, value]) => ({
    date,
    averageScore: value.scoreCount
      ? Math.round(value.scoreTotal / value.scoreCount)
      : 0,
    waterMl: value.waterMl,
    hasLowSodium: value.hasLowSodium,
    hasHighSodium: value.hasHighSodium,
    hasBalancedMeal: value.hasBalancedMeal,
    hasSoftDrink: value.hasSoftDrink,
  }));

  const streakFromPredicate = (predicate) => {
    let current = 0;
    let longest = 0;
    let run = 0;

    for (const item of series) {
      if (predicate(item)) {
        run += 1;
        longest = Math.max(longest, run);
      } else {
        run = 0;
      }
    }

    for (let index = series.length - 1; index >= 0; index -= 1) {
      if (predicate(series[index])) {
        current += 1;
      } else {
        break;
      }
    }

    return { current, longest };
  };

  const hydration = streakFromPredicate((item) => item.waterMl >= 1500);
  const healthyMeals = streakFromPredicate((item) => item.hasBalancedMeal);
  const softDrinkFree = streakFromPredicate((item) => !item.hasSoftDrink);

  const rewards = [
    hydration.current >= 3
      ? {
          title: "Hydration streak",
          detail: `${hydration.current} days of good hydration`,
        }
      : null,
    healthyMeals.current >= 3
      ? {
          title: "Balanced meal streak",
          detail: `${healthyMeals.current} days of balanced meals`,
        }
      : null,
    softDrinkFree.current >= 3
      ? {
          title: "Soft drink reduction",
          detail: `${softDrinkFree.current} days without soft drinks`,
        }
      : null,
  ].filter(Boolean);

  return {
    series,
    streaks: {
      hydration,
      healthyMeals,
      softDrinkFree,
    },
    rewards,
  };
};
