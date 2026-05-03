import foodCatalog from "../../data/filipino-food-database.json" with { type: "json" };

const normalizeText = (value) =>
  String(value ?? "")
    .trim()
    .toLowerCase();

const toNumber = (value, fallback = 0) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

const FOOD_INDEX = foodCatalog.map((item) => ({
  ...item,
  normalizedAliases: (item.aliases ?? []).map(normalizeText),
}));

const quantityPatterns = [
  { pattern: /\bhalf\b|\bkalahati\b|\bhati\b/, factor: 0.5 },
  { pattern: /\bsmall\b|\bmini\b/, factor: 0.75 },
  { pattern: /\blarge\b|\bbig\b|\bextra\b/, factor: 1.35 },
];

const segmentTokens = (text) =>
  String(text ?? "")
    .split(/\s*(?:\+|,|&|\band\b|\bwith\b|\bkasama\b|\bplus\b)\s*/i)
    .map((part) => part.trim())
    .filter(Boolean);

const FOOD_TYPE_RULES = [
  {
    type: "drink",
    patterns: [
      /\bwater\b/,
      /\btubig\b/,
      /\bjuice\b/,
      /\bcoffee\b/,
      /\btea\b/,
      /\bmilk\b/,
      /\bsoda\b/,
      /\bsoft drink\b/,
    ],
  },
  {
    type: "dessert",
    patterns: [
      /\bdessert\b/,
      /\bsweet\b/,
      /\bcake\b/,
      /\bice cream\b/,
      /\bcookie\b/,
      /\bchocolate\b/,
      /\bpudding\b/,
      /\bleche flan\b/,
    ],
  },
  {
    type: "breakfast",
    patterns: [
      /\bbreakfast\b/,
      /\bsilog\b/,
      /\btsilog\b/,
      /\blongsilog\b/,
      /\bcorndog\b/,
    ],
  },
  {
    type: "soup",
    patterns: [
      /\bsoup\b/,
      /\bsinigang\b/,
      /\blugaw\b/,
      /\barroz caldo\b/,
      /\bcongee\b/,
    ],
  },
  {
    type: "snack",
    patterns: [
      /\bsnack\b/,
      /\bstreet food\b/,
      /\bfishball\b/,
      /\bkikiam\b/,
      /\bkwek kwek\b/,
      /\bisaw\b/,
    ],
  },
  {
    type: "packaged food",
    patterns: [
      /\bpackaged\b/,
      /\binstant noodles\b/,
      /\bcanned\b/,
      /\bbottle\b/,
      /\bjar\b/,
    ],
  },
];

const LABEL_BY_CATEGORY = {
  drink: "drink",
  dessert: "dessert",
  breakfast: "breakfast",
  soup: "soup",
  snack: "snack",
  packaged: "packaged food",
  "mixed meal": "mixed meal",
  ulam: "main dish",
  protein: "protein food",
  carbohydrate: "carbohydrate food",
  noodles: "noodles",
  fruit: "fruit",
  vegetable: "vegetable",
  grain: "grain",
};

const normalizeFoodType = (value) =>
  String(value ?? "")
    .trim()
    .toLowerCase();

const inferFoodTypeFromText = (mealText = "") => {
  const lowered = normalizeFoodType(mealText);
  if (!lowered) {
    return "meal";
  }

  for (const rule of FOOD_TYPE_RULES) {
    if (rule.patterns.some((pattern) => pattern.test(lowered))) {
      return rule.type;
    }
  }

  return "meal";
};

export const inferFoodType = ({
  mealText = "",
  matchedFoods = [],
  fallbackCategory = null,
} = {}) => {
  const categories = matchedFoods
    .map((match) => normalizeFoodType(match?.item?.category))
    .filter(Boolean);
  const textType = inferFoodTypeFromText(mealText);

  if (textType !== "meal") {
    return textType;
  }

  if (categories.includes("drink")) {
    return "drink";
  }

  if (categories.includes("dessert")) {
    return "dessert";
  }

  if (categories.includes("breakfast")) {
    return "breakfast";
  }

  if (categories.includes("soup")) {
    return "soup";
  }

  if (categories.includes("snack")) {
    return "snack";
  }

  if (categories.includes("packaged")) {
    return "packaged food";
  }

  if (categories.length === 1) {
    return LABEL_BY_CATEGORY[categories[0]] ?? categories[0];
  }

  if (categories.length > 1) {
    return "mixed meal";
  }

  const normalizedFallback = normalizeFoodType(fallbackCategory);
  if (normalizedFallback) {
    return LABEL_BY_CATEGORY[normalizedFallback] ?? normalizedFallback;
  }

  return "meal";
};

export const getFilipinoFoodCatalog = () =>
  FOOD_INDEX.map(({ normalizedAliases, ...item }) => item);

export const getFoodByName = (name) => {
  const lowered = normalizeText(name);
  return FOOD_INDEX.find((item) => item.name.toLowerCase() === lowered) ?? null;
};

const matchCatalogItem = (segment) => {
  const lowered = normalizeText(segment);
  const matches = FOOD_INDEX.filter((item) =>
    item.normalizedAliases.some((alias) => alias && lowered.includes(alias)),
  );
  if (!matches.length) {
    return null;
  }

  const scoreItem = (item) => {
    let best = 0;
    for (const alias of item.normalizedAliases) {
      if (!alias) {
        continue;
      }
      if (lowered === alias) {
        best = Math.max(best, 1000 + alias.length);
        continue;
      }
      if (lowered.includes(alias)) {
        best = Math.max(best, 500 + alias.length);
        continue;
      }
      if (alias.includes(lowered)) {
        best = Math.max(best, 250 + alias.length);
      }
    }
    return best;
  };

  matches.sort((a, b) => scoreItem(b) - scoreItem(a));

  return matches[0];
};

const estimateMultiplier = (segment) => {
  const lowered = normalizeText(segment);
  let multiplier = 1;

  for (const rule of quantityPatterns) {
    if (rule.pattern.test(lowered)) {
      multiplier *= rule.factor;
    }
  }

  const explicitQuantity = lowered.match(
    /\b(\d+(?:\.\d+)?)\s*(cup|cups|piece|pieces|pc|pcs|slice|slices|stick|sticks|serving|servings|bowl|bowls|plate|plates|glass|glasses)\b/,
  );
  if (explicitQuantity) {
    multiplier *= clamp(toNumber(explicitQuantity[1], 1), 0.25, 4);
  }

  const repeatMatch = lowered.match(/\b(\d+)\s*(?:x|times)\b/);
  if (repeatMatch) {
    multiplier *= clamp(toNumber(repeatMatch[1], 1), 1, 4);
  }

  return clamp(multiplier, 0.25, 4);
};

const emptyNutrition = () => ({
  calories: 0,
  sugarGrams: 0,
  sodiumMg: 0,
  fatGrams: 0,
  proteinGrams: 0,
  fiberGrams: 0,
});

const addNutrition = (target, source, multiplier = 1) => {
  for (const key of Object.keys(target)) {
    target[key] += toNumber(source?.[key], 0) * multiplier;
  }
  return target;
};

const mergeLists = (...lists) => [
  ...new Set(
    lists
      .flat()
      .map((item) => String(item ?? "").trim())
      .filter(Boolean),
  ),
];

const detectWarnings = ({ profile = {}, mealText = "", matches = [] }) => {
  const warnings = [];
  const loweredMeal = normalizeText(mealText);
  const allergyTerms = mergeLists(
    profile.allergies,
    profile.dietRestrictions,
    profile.healthGoal,
  )
    .map(normalizeText)
    .filter(Boolean);

  if (allergyTerms.some((term) => term && loweredMeal.includes(term))) {
    warnings.push(
      "This meal may conflict with one of the profile restrictions or allergies.",
    );
  }

  for (const item of matches) {
    for (const warning of item.warnings ?? []) {
      if (!warnings.includes(warning)) {
        warnings.push(warning);
      }
    }
    for (const ingredient of item.ingredients ?? []) {
      if (
        allergyTerms.some(
          (term) => term && normalizeText(ingredient).includes(term),
        )
      ) {
        warnings.push(`May contain ${ingredient}.`);
      }
    }
  }

  return [...new Set(warnings)];
};

const detectMatchedFoods = (mealText) => {
  const segments = segmentTokens(mealText);
  const matched = [];

  for (const segment of segments.length ? segments : [mealText]) {
    const item = matchCatalogItem(segment);
    if (item) {
      matched.push({ item, multiplier: estimateMultiplier(segment), segment });
    }
  }

  if (!matched.length) {
    const fallbackText = normalizeText(mealText);
    const genericAliases = [
      "rice",
      "egg",
      "banana",
      "oats",
      "tuna",
      "cabbage",
      "water",
    ];
    for (const alias of genericAliases) {
      const item = FOOD_INDEX.find((entry) =>
        entry.normalizedAliases.includes(alias),
      );
      if (item && fallbackText.includes(alias)) {
        matched.push({
          item,
          multiplier: estimateMultiplier(mealText),
          segment: mealText,
        });
      }
    }
  }

  const unique = [];
  const seen = new Set();
  for (const match of matched) {
    if (!seen.has(match.item.name)) {
      seen.add(match.item.name);
      unique.push(match);
    }
  }

  return unique;
};

const buildFallbackMeal = (mealText) => {
  const lowered = normalizeText(mealText);
  if (!lowered) {
    return {
      name: "Meal",
      nutrition: emptyNutrition(),
      priceEstimatePhp: null,
      matchedFoods: [],
      foodType: "meal",
    };
  }

  if (lowered.includes("carinderia") || lowered.includes("turo turo")) {
    return {
      name: "Carinderia meal",
      nutrition: {
        calories: 480,
        sugarGrams: 4,
        sodiumMg: 760,
        fatGrams: 18,
        proteinGrams: 18,
        fiberGrams: 3,
      },
      priceEstimatePhp: 80,
      matchedFoods: [],
      foodType: "mixed meal",
    };
  }

  if (lowered.includes("street food")) {
    return {
      name: "Street food mix",
      nutrition: {
        calories: 260,
        sugarGrams: 4,
        sodiumMg: 650,
        fatGrams: 14,
        proteinGrams: 8,
        fiberGrams: 1,
      },
      priceEstimatePhp: 35,
      matchedFoods: [],
      foodType: "snack",
    };
  }

  if (lowered.includes("breakfast") || lowered.includes("silog")) {
    return {
      name: "Breakfast meal",
      nutrition: {
        calories: 520,
        sugarGrams: 3,
        sodiumMg: 720,
        fatGrams: 18,
        proteinGrams: 16,
        fiberGrams: 2,
      },
      priceEstimatePhp: 70,
      matchedFoods: [],
      foodType: "breakfast",
    };
  }

  if (
    lowered.includes("dessert") ||
    lowered.includes("cake") ||
    lowered.includes("ice cream") ||
    lowered.includes("sweet")
  ) {
    return {
      name: "Dessert",
      nutrition: {
        calories: 220,
        sugarGrams: 24,
        sodiumMg: 80,
        fatGrams: 8,
        proteinGrams: 3,
        fiberGrams: 1,
      },
      priceEstimatePhp: 45,
      matchedFoods: [],
      foodType: "dessert",
    };
  }

  if (lowered.includes("water") || lowered.includes("tubig")) {
    return {
      name: "Water",
      nutrition: emptyNutrition(),
      priceEstimatePhp: 0,
      matchedFoods: [],
      foodType: "drink",
    };
  }

  return {
    name: "Meal",
    nutrition: emptyNutrition(),
    priceEstimatePhp: null,
    matchedFoods: [],
    foodType: inferFoodTypeFromText(mealText),
  };
};

export const estimateMealFromText = ({
  mealText,
  profile = {},
  budgetMode = false,
}) => {
  const matchedFoods = detectMatchedFoods(mealText);
  const fallback = buildFallbackMeal(mealText);
  const foodType = inferFoodType({
    mealText,
    matchedFoods,
    fallbackCategory: fallback.foodType,
  });

  if (!matchedFoods.length) {
    return {
      mealName: fallback.name,
      nutrition: fallback.nutrition,
      priceEstimatePhp: budgetMode
        ? fallback.priceEstimatePhp
        : fallback.priceEstimatePhp,
      matchedFoods: [],
      groceryList: [],
      warnings: detectWarnings({ profile, mealText, matches: [] }),
      budgetMode,
      foodType,
    };
  }

  const nutrition = emptyNutrition();
  let priceEstimatePhp = 0;

  for (const match of matchedFoods) {
    addNutrition(nutrition, match.item.nutrition, match.multiplier);
    priceEstimatePhp +=
      toNumber(match.item.priceEstimatePhp, 0) * match.multiplier;
  }

  const groceryList = mergeLists(
    matchedFoods.flatMap((match) => match.item.ingredients ?? []),
  );

  return {
    mealName: matchedFoods.map((match) => match.item.name).join(" + "),
    nutrition: {
      calories: Math.round(nutrition.calories),
      sugarGrams: Number(nutrition.sugarGrams.toFixed(1)),
      sodiumMg: Math.round(nutrition.sodiumMg),
      fatGrams: Number(nutrition.fatGrams.toFixed(1)),
      proteinGrams: Number(nutrition.proteinGrams.toFixed(1)),
      fiberGrams: Number(nutrition.fiberGrams.toFixed(1)),
    },
    priceEstimatePhp: Math.round(priceEstimatePhp),
    matchedFoods: matchedFoods.map((match) => ({
      name: match.item.name,
      segment: match.segment,
      multiplier: Number(match.multiplier.toFixed(2)),
      category: match.item.category,
      supportLevel: match.item.supportLevel,
    })),
    groceryList,
    warnings: detectWarnings({
      profile,
      mealText,
      matches: matchedFoods.map((match) => match.item),
    }),
    budgetMode,
    foodType,
  };
};

export const buildBudgetMealSuggestions = ({
  profile = {},
  maxPhp = 100,
  currency = "PHP",
} = {}) => {
  const recipes = [
    {
      name: "Rice, egg, banana, and water",
      items: ["Steamed rice", "Boiled egg", "Banana", "Water"],
    },
    {
      name: "Monggo rice bowl",
      items: ["Monggo with vegetables", "Steamed rice", "Water"],
    },
    {
      name: "Lugaw with egg and banana",
      items: ["Lugaw", "Boiled egg", "Banana"],
    },
    {
      name: "Tuna cabbage rice meal",
      items: ["Tuna", "Cabbage", "Steamed rice", "Water"],
    },
  ];

  return recipes
    .map((recipe) => {
      const matchedItems = recipe.items.map(getFoodByName).filter(Boolean);
      const nutrition = matchedItems.reduce(
        (acc, item) => addNutrition(acc, item.nutrition, 1),
        emptyNutrition(),
      );
      const priceEstimatePhp = matchedItems.reduce(
        (sum, item) => sum + toNumber(item.priceEstimatePhp, 0),
        0,
      );
      const warnings = mergeLists(
        matchedItems.flatMap((item) => item.warnings ?? []),
        matchedItems.some((item) =>
          (profile.allergies ?? []).some((allergy) =>
            normalizeText(item.ingredients?.join(" ")).includes(
              normalizeText(allergy),
            ),
          ),
        )
          ? ["Check allergens before serving."]
          : [],
      );

      return {
        name: recipe.name,
        currency,
        priceEstimatePhp,
        underBudget: priceEstimatePhp <= maxPhp,
        nutrition: {
          calories: Math.round(nutrition.calories),
          sugarGrams: Number(nutrition.sugarGrams.toFixed(1)),
          sodiumMg: Math.round(nutrition.sodiumMg),
          fatGrams: Number(nutrition.fatGrams.toFixed(1)),
          proteinGrams: Number(nutrition.proteinGrams.toFixed(1)),
          fiberGrams: Number(nutrition.fiberGrams.toFixed(1)),
        },
        groceryList: mergeLists(
          ...matchedItems.map((item) => item.ingredients ?? []),
        ),
        warnings,
        supportLevel: matchedItems.reduce((best, item) => {
          if (item.supportLevel === "High" || best === "High") {
            return "High";
          }
          if (item.supportLevel === "Medium" || best === "Medium") {
            return "Medium";
          }
          return "Low";
        }, "Low"),
      };
    })
    .filter((recipe) => recipe.underBudget)
    .sort((a, b) => a.priceEstimatePhp - b.priceEstimatePhp);
};

export const buildGroceryList = ({
  meals = [],
  budgetSuggestions = [],
} = {}) => {
  const items = [
    ...meals.flatMap(
      (meal) => meal.groceryList ?? meal.betterAlternatives ?? [],
    ),
    ...budgetSuggestions.flatMap((meal) => meal.groceryList ?? []),
  ];

  return [
    ...new Set(items.map((item) => String(item ?? "").trim()).filter(Boolean)),
  ];
};

export const buildWellnessReminders = ({
  profile = {},
  healthContext = null,
  nutrition = {},
  waterTargetMl = 2000,
  waterTotalMl = 0,
  budgetContext = null,
} = {}) => {
  const reminders = [];
  const status = normalizeText(healthContext?.status);

  if (
    status.includes("pregnant") ||
    status.includes("surgery") ||
    status.includes("doctor") ||
    status.includes("soft food")
  ) {
    reminders.push("Follow the doctor-advised restriction first.");
  }

  if ((nutrition.sodiumMg ?? 0) > 600) {
    reminders.push("Avoid flagged high-sodium foods when possible.");
  }

  if (
    (nutrition.proteinGrams ?? 0) < 10 &&
    !normalizeText(profile.healthGoal).includes("low protein")
  ) {
    reminders.push("Add a protein source if it fits your plan.");
  }

  if (waterTotalMl < waterTargetMl * 0.75) {
    reminders.push("Drink more water to stay on track today.");
  }

  if ((profile.allergies ?? []).length) {
    reminders.push("Check allergen labels or ingredients before eating.");
  }

  if (budgetContext?.overBudget) {
    reminders.push(
      `You are over budget today by about PHP ${Math.abs(budgetContext.remainingToday ?? 0).toFixed(2)}.`,
    );
  } else if (budgetContext?.remainingToday != null) {
    reminders.push(
      `You have about PHP ${budgetContext.remainingToday.toFixed(2)} left in today's food budget.`,
    );
  }

  return [...new Set(reminders)];
};

export const getSafetySection = () => ({
  disclaimer:
    "KainWise provides general wellness guidance only. It does not diagnose, treat, or replace professional medical advice.",
  privacy: [
    "Private diary lock is available.",
    "Users control their own data.",
    "History can be deleted from the app.",
    "No public sharing by default.",
  ],
  boundaries: [
    "Use doctor-advised diets as the primary rule.",
    "Treat allergy warnings as cautionary prompts, not medical diagnosis.",
    "Use emergency services for urgent symptoms.",
  ],
  familyMode: [
    "Family or caregiver support can be used to review grocery lists and meal reminders.",
    "Parent or recovery support can share the same wellness plan without public posting.",
  ],
});
