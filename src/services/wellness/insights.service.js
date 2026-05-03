export const buildWeeklyInsights = ({
  summaries = [],
  scans = [],
  diaries = [],
}) => {
  const insights = [];
  const lowEnergyDays = diaries.filter(
    (diary) => (diary.energyLevel ?? 3) <= 3,
  ).length;
  const highSodiumDays = scans.filter(
    (scan) => (scan.nutrition?.sodiumMg ?? 0) > 600,
  ).length;
  const highProteinDays = scans.filter(
    (scan) => (scan.nutrition?.proteinGrams ?? 0) >= 15,
  ).length;
  const lowWaterDays = diaries.filter(
    (diary) => (diary.waterIntakeMl ?? 0) < 1500,
  ).length;
  const shortSleepDays = diaries.filter(
    (diary) => (diary.sleepHours ?? 7) < 6,
  ).length;
  const avgScore = summaries.length
    ? Math.round(
        summaries.reduce((sum, item) => sum + item.score, 0) / summaries.length,
      )
    : null;

  if (lowEnergyDays > 0) {
    insights.push(
      "Low energy appears on days with lighter meals or missed breakfast.",
    );
  }

  if (highSodiumDays > 0) {
    insights.push(
      "Sodium is elevated on some days, often from processed or instant foods.",
    );
  }

  if (highProteinDays > 0) {
    insights.push(
      "Protein intake improves support on days with eggs, fish, tofu, or chicken.",
    );
  }

  if (lowWaterDays > 0) {
    insights.push("Hydration looks better on days with more water intake.");
  }

  if (shortSleepDays > 0) {
    insights.push("Short sleep may be lowering energy and mood on some days.");
  }

  if (avgScore !== null) {
    insights.push(`Average wellness score this week is ${avgScore}/100.`);
  }

  if (!insights.length) {
    insights.push(
      "Keep scanning meals and adding diary entries to reveal wellness patterns.",
    );
  }

  return insights;
};
