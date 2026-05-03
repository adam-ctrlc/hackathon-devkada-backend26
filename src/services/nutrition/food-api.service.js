import { env } from "../../config/env.js";

const toNumber = (value) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const pickNutrient = (nutriments, keys = []) => {
  for (const key of keys) {
    const value = toNumber(nutriments?.[key]);
    if (value !== null) {
      return value;
    }
  }

  return null;
};

const pickSodiumMg = (nutriments) => {
  const value = pickNutrient(nutriments, ["sodium_100g", "sodium"]);
  return value != null ? value * 1000 : null;
};

export const searchOpenFoodFacts = async (query) => {
  const term = String(query ?? "").trim();
  if (!term) {
    return null;
  }

  const url = new URL("/cgi/search.pl", env.openFoodFactsApiBaseUrl);
  url.searchParams.set("search_terms", term);
  url.searchParams.set("search_simple", "1");
  url.searchParams.set("action", "process");
  url.searchParams.set("json", "1");
  url.searchParams.set("page_size", String(env.openFoodFactsPageSize));

  const response = await fetch(url, {
    headers: {
      "User-Agent": env.openFoodFactsUserAgent,
    },
  });
  if (!response.ok) {
    return null;
  }

  const data = await response.json();
  const product = data?.products?.find(
    (item) => item?.product_name || item?.generic_name || item?.brands,
  );

  if (!product) {
    return null;
  }

  const nutriments = product.nutriments ?? {};
  const nutrition = {
    calories: pickNutrient(nutriments, [
      "energy-kcal_100g",
      "energy-kcal",
      "energy_100g",
    ]),
    sugarGrams: pickNutrient(nutriments, ["sugars_100g", "sugars"]),
    sodiumMg: pickSodiumMg(nutriments),
    fatGrams: pickNutrient(nutriments, ["fat_100g", "fat"]),
    proteinGrams: pickNutrient(nutriments, ["proteins_100g", "proteins"]),
    fiberGrams: pickNutrient(nutriments, ["fiber_100g", "fiber"]),
  };

  return {
    source: "open-food-facts",
    productName: product.product_name || product.generic_name || term,
    brand: product.brands ?? null,
    categories: product.categories ?? null,
    allergens: product.allergens_from_ingredients ?? product.allergens ?? null,
    nutrition,
    raw: product,
  };
};

export const lookupOpenFoodFactsBarcode = async (barcode) => {
  const code = String(barcode ?? "").trim();
  if (!code) {
    return null;
  }

  const url = new URL(
    `/api/v2/product/${encodeURIComponent(code)}.json`,
    env.barcodeApiBaseUrl,
  );
  const response = await fetch(url, {
    headers: {
      "User-Agent": env.barcodeApiUserAgent,
    },
  });

  if (!response.ok) {
    return null;
  }

  const data = await response.json();
  if (data?.status !== 1 || !data?.product) {
    return null;
  }

  const product = data.product;
  const nutriments = product.nutriments ?? {};
  const nutrition = {
    calories: pickNutrient(nutriments, [
      "energy-kcal_100g",
      "energy-kcal",
      "energy_100g",
    ]),
    sugarGrams: pickNutrient(nutriments, ["sugars_100g", "sugars"]),
    sodiumMg: pickSodiumMg(nutriments),
    fatGrams: pickNutrient(nutriments, ["fat_100g", "fat"]),
    proteinGrams: pickNutrient(nutriments, ["proteins_100g", "proteins"]),
    fiberGrams: pickNutrient(nutriments, ["fiber_100g", "fiber"]),
  };

  return {
    source: "open-food-facts",
    barcode: code,
    productName: product.product_name || product.generic_name || code,
    brand: product.brands ?? null,
    categories: product.categories ?? null,
    allergens: product.allergens_from_ingredients ?? product.allergens ?? null,
    nutrition,
    raw: product,
  };
};
