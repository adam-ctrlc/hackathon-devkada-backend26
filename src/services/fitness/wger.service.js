import { env } from "../../config/env.js";

const normalizeText = (value) =>
  String(value ?? "")
    .trim()
    .toLowerCase();

const safeTrim = (value) => (typeof value === "string" ? value.trim() : "");

const buildUrl = (path, searchParams = {}) => {
  const baseUrl = safeTrim(env.wgerApiBaseUrl) || "https://wger.de";
  const url = new URL(path, `${baseUrl.replace(/\/+$/, "")}/`);

  for (const [key, value] of Object.entries(searchParams)) {
    if (value === undefined || value === null || value === "") {
      continue;
    }
    url.searchParams.set(key, String(value));
  }

  return url;
};

const fetchWgerJson = async (path, searchParams = {}) => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);

  try {
    const response = await fetch(buildUrl(path, searchParams), {
      headers: {
        Accept: "application/json",
        ...(safeTrim(env.wgerApiToken)
          ? { Authorization: `Token ${safeTrim(env.wgerApiToken)}` }
          : {}),
      },
      signal: controller.signal,
    });

    if (!response.ok) {
      const error = new Error(
        `Wger request failed with status ${response.status}`,
      );
      error.status = response.status >= 500 ? 502 : response.status;
      throw error;
    }

    return response.json();
  } catch (error) {
    if (error?.name === "AbortError") {
      const timeoutError = new Error("Wger request timed out");
      timeoutError.status = 502;
      throw timeoutError;
    }

    if (!error.status) {
      error.status = 502;
    }

    throw error;
  } finally {
    clearTimeout(timeout);
  }
};

const mapExercise = (exercise, lookups = {}) => {
  const category = lookups.categories.get(exercise.category) ?? null;
  const muscles = (exercise.muscles ?? [])
    .map((id) => lookups.muscles.get(id))
    .filter(Boolean);
  const secondaryMuscles = (exercise.muscles_secondary ?? [])
    .map((id) => lookups.muscles.get(id))
    .filter(Boolean);
  const equipment = (exercise.equipment ?? [])
    .map((id) => lookups.equipment.get(id))
    .filter(Boolean);

  return {
    id: exercise.id,
    uuid: exercise.uuid,
    categoryId: exercise.category,
    category: category?.name ?? category?.name_en ?? null,
    muscles,
    secondaryMuscles,
    equipment,
    lastUpdate: exercise.last_update ?? null,
    licenseAuthor: exercise.license_author ?? null,
  };
};

let lookupCache = null;
let lookupCacheAt = 0;

const buildLookupTables = async () => {
  const cacheTtlMs = 10 * 60 * 1000;
  if (lookupCache && Date.now() - lookupCacheAt < cacheTtlMs) {
    return lookupCache;
  }

  const [categories, muscles, equipment] = await Promise.all([
    fetchWgerJson("/api/v2/exercisecategory/", { limit: 100 }),
    fetchWgerJson("/api/v2/muscle/", { limit: 100 }),
    fetchWgerJson("/api/v2/equipment/", { limit: 100 }),
  ]);

  lookupCache = {
    categories: new Map(
      (categories?.results ?? []).map((item) => [item.id, item]),
    ),
    muscles: new Map((muscles?.results ?? []).map((item) => [item.id, item])),
    equipment: new Map(
      (equipment?.results ?? []).map((item) => [item.id, item]),
    ),
  };
  lookupCacheAt = Date.now();

  return lookupCache;
};

const inferWorkoutFocus = (profile = {}) => {
  const goal = normalizeText(profile.healthGoal);
  const activityLevel = normalizeText(profile.activityLevel);
  const age = Number(profile.age);

  if (goal.includes("lose weight") || goal.includes("fat loss")) {
    return "fat-loss";
  }

  if (goal.includes("gain weight") || goal.includes("build muscle")) {
    return "strength";
  }

  if (goal.includes("improve energy") || goal.includes("wellness")) {
    return "general-fitness";
  }

  if (Number.isFinite(age) && age >= 50) {
    return "mobility";
  }

  if (activityLevel.includes("active")) {
    return "conditioning";
  }

  return "general-fitness";
};

const buildSearchQuery = (focus, profile = {}, query = "") => {
  const userQuery = safeTrim(query);
  if (userQuery) {
    return userQuery;
  }

  const restrictions = [
    ...(Array.isArray(profile.dietRestrictions)
      ? profile.dietRestrictions
      : []),
    ...(Array.isArray(profile.allergies) ? profile.allergies : []),
  ]
    .map(normalizeText)
    .join(" ");

  if (restrictions.includes("soft food")) {
    return "mobility";
  }

  switch (focus) {
    case "strength":
      return "strength";
    case "fat-loss":
      return "cardio";
    case "mobility":
      return "stretch";
    case "conditioning":
      return "circuit";
    default:
      return "full body";
  }
};

export const listWgerExercises = async ({
  query = "",
  limit = 10,
  offset = 0,
  category = null,
  muscle = null,
  equipment = null,
} = {}) => {
  const data = await fetchWgerJson("/api/v2/exercise/", {
    search: query ? query : undefined,
    limit,
    offset,
    category: category ?? undefined,
    muscles: muscle ?? undefined,
    equipment: equipment ?? undefined,
  });
  const lookups = await buildLookupTables();

  return {
    count: data?.count ?? 0,
    next: data?.next ?? null,
    previous: data?.previous ?? null,
    results: (data?.results ?? []).map((exercise) =>
      mapExercise(exercise, lookups),
    ),
  };
};

export const listWgerMuscles = async ({ limit = 100, offset = 0 } = {}) => {
  const data = await fetchWgerJson("/api/v2/muscle/", { limit, offset });
  return data ?? { count: 0, next: null, previous: null, results: [] };
};

export const listWgerEquipment = async ({ limit = 100, offset = 0 } = {}) => {
  const data = await fetchWgerJson("/api/v2/equipment/", { limit, offset });
  return data ?? { count: 0, next: null, previous: null, results: [] };
};

export const buildWgerWorkoutSuggestions = async ({
  profile = {},
  query = "",
  limit = 5,
} = {}) => {
  const focus = inferWorkoutFocus(profile);
  const search = buildSearchQuery(focus, profile, query);
  const exercises = await listWgerExercises({ query: search, limit });

  return {
    focus,
    search,
    title:
      focus === "strength"
        ? "Strength day"
        : focus === "fat-loss"
          ? "Cardio day"
          : focus === "mobility"
            ? "Mobility day"
            : "General fitness day",
    exercises: exercises.results.slice(0, limit),
    source: "wger",
  };
};
