import KNN from "ml-knn";
import trainingExamples from "../../data/meal-training-examples.json" with { type: "json" };

const normalizeText = (value) =>
  String(value ?? "")
    .trim()
    .toLowerCase();
const scaled = (value, divisor) => (Number(value) || 0) / divisor;

const buildFeatureVector = ({
  nutrition = {},
  profile,
  healthStatus,
  productName,
}) => {
  const restrictionText = [
    healthStatus,
    ...(Array.isArray(profile?.dietRestrictions)
      ? profile.dietRestrictions
      : []),
    ...(Array.isArray(profile?.allergies) ? profile.allergies : []),
    profile?.healthGoal,
    productName,
  ]
    .filter(Boolean)
    .map(normalizeText)
    .join(" ");

  return [
    scaled(nutrition.calories, 100),
    scaled(nutrition.sugarGrams, 5),
    scaled(nutrition.sodiumMg, 100),
    scaled(nutrition.fatGrams, 5),
    scaled(nutrition.proteinGrams, 5),
    scaled(nutrition.fiberGrams, 2),
    restrictionText.includes("low sodium") ? 1 : 0,
    restrictionText.includes("low sugar") ? 1 : 0,
    restrictionText.includes("soft") ? 1 : 0,
    restrictionText.includes("pregnant") ? 1 : 0,
    restrictionText.includes("surgery") ? 1 : 0,
    restrictionText.includes("allergy") ? 1 : 0,
  ];
};

const knn = new KNN(
  trainingExamples.map((sample) => buildFeatureVector(sample)),
  trainingExamples.map((sample) => sample.label),
  { k: 5 },
);

export const predictMealSupportLevel = ({
  nutrition,
  profile,
  healthStatus,
  productName,
}) => {
  const prediction = knn.predict([
    buildFeatureVector({ nutrition, profile, healthStatus, productName }),
  ])[0];
  switch (prediction) {
    case "High":
      return "High";
    case "Low":
      return "Low";
    default:
      return "Medium";
  }
};
