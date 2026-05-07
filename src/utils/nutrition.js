export const toNullableNumber = (value) => {
  if (value === undefined || value === null || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

export const normalizeNutritionFields = (nutrition = {}) => ({
  calories: toNullableNumber(nutrition.calories),
  sugarGrams: toNullableNumber(nutrition.sugarGrams),
  sodiumMg: toNullableNumber(nutrition.sodiumMg),
  fatGrams: toNullableNumber(nutrition.fatGrams),
  proteinGrams: toNullableNumber(nutrition.proteinGrams),
  fiberGrams: toNullableNumber(nutrition.fiberGrams),
});
