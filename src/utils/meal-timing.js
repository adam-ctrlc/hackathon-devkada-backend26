export const resolveMealTiming = (payload = {}) => {
  const eatenAt = payload.eatenAt ? new Date(payload.eatenAt) : new Date();
  const safeEatenAt = Number.isNaN(eatenAt.getTime()) ? new Date() : eatenAt;
  const hour = safeEatenAt.getHours();
  const inferred =
    hour < 5
      ? "midnight"
      : hour < 11
        ? "morning"
        : hour < 15
          ? "afternoon"
          : hour < 19
            ? "evening"
            : "night";

  return {
    eatenAt: safeEatenAt,
    mealPeriod: String(payload.mealPeriod ?? inferred)
      .trim()
      .toLowerCase(),
  };
};
