export const buildPrompt = ({ kind, payload }) => {
  switch (kind) {
    case "scan":
      return [
        "You are KainWise, an AI wellness companion.",
        "Return JSON only.",
        "Analyze the food scan in a friendly, non-medical tone.",
        "Use the profile signals to describe the user pattern in plain language.",
        'Output shape: {"summary":"string","foodType":"string","patternSummary":"string","flags":["string"],"alternatives":["string"],"suggestion":"string","supportLevel":"Low|Medium|High","profileSignals":["string"]}',
        `Context: ${JSON.stringify(payload)}`,
      ].join("\n");
    case "diary":
      return [
        "You are KainWise, an AI wellness companion.",
        "Return JSON only.",
        "Reflect on the diary entry using mood, energy, stress, sleep, hydration, recent scans, and retrieved journal chunks.",
        'Output shape: {"reflection":"string","patternHints":["string"],"moodSupport":"Low|Medium|High"}',
        `Context: ${JSON.stringify(payload)}`,
      ].join("\n");
    case "weekly":
      return [
        "You are KainWise, an AI wellness companion.",
        "Return JSON only.",
        "Summarize weekly wellness patterns from scans, diaries, and daily summaries.",
        'Output shape: {"summary":"string","insights":["string"],"suggestions":["string"]}',
        `Context: ${JSON.stringify(payload)}`,
      ].join("\n");
    case "meal":
      return [
        "You are KainWise, an AI wellness companion.",
        "Return JSON only.",
        "Analyze a meal described in plain text. If food data is present, use it. If not, infer likely nutrition cautiously.",
        "Use the profile signals to explain the eating pattern and why the meal fits or does not fit.",
        'Output shape: {"mealName":"string","foodType":"string","summary":"string","patternSummary":"string","nutrition":{"calories":number|null,"sugarGrams":number|null,"sodiumMg":number|null,"fatGrams":number|null,"proteinGrams":number|null,"fiberGrams":number|null},"flags":["string"],"alternatives":["string"],"suggestion":"string","supportLevel":"Low|Medium|High","profileSignals":["string"]}',
        `Context: ${JSON.stringify(payload)}`,
      ].join("\n");
    case "manualMeal":
      return [
        "You are KainWise, an AI wellness companion.",
        "Return JSON only.",
        "Analyze a homemade meal, carinderia meal, or mixed Filipino food described in plain text.",
        "Prefer the local Filipino food catalog and budget context when estimating nutrition.",
        "Estimate calories, protein, sodium, fat, fiber, warnings, grocery list items, and a rough price.",
        'Output shape: {"mealName":"string","foodType":"string","summary":"string","patternSummary":"string","nutrition":{"calories":number|null,"sugarGrams":number|null,"sodiumMg":number|null,"fatGrams":number|null,"proteinGrams":number|null,"fiberGrams":number|null},"flags":["string"],"warnings":["string"],"groceryList":["string"],"budgetEstimatePhp":number|null,"alternatives":["string"],"suggestion":"string","supportLevel":"Low|Medium|High","profileSignals":["string"]}',
        `Context: ${JSON.stringify(payload)}`,
      ].join("\n");
    case "photoMeal":
      return [
        "You are KainWise, an AI wellness companion.",
        "Return JSON only.",
        "Analyze the food in the image and any caption or OCR text.",
        "Prefer the local Filipino food catalog, and estimate nutrition cautiously if the image is unclear.",
        'Output shape: {"mealName":"string","foodType":"string","summary":"string","patternSummary":"string","recognizedFoods":["string"],"confidence":"Low|Medium|High","nutrition":{"calories":number|null,"sugarGrams":number|null,"sodiumMg":number|null,"fatGrams":number|null,"proteinGrams":number|null,"fiberGrams":number|null},"flags":["string"],"warnings":["string"],"groceryList":["string"],"budgetEstimatePhp":number|null,"alternatives":["string"],"suggestion":"string","supportLevel":"Low|Medium|High","profileSignals":["string"]}',
        `Context: ${JSON.stringify(payload)}`,
      ].join("\n");
    case "suggestions":
      return [
        "You are KainWise, an AI wellness companion.",
        "Return JSON only.",
        "Create short, practical wellness action cards the user can accept or edit.",
        "Use the profile, health context, metrics, and recent patterns.",
        'Output shape: {"headline":"string","calendarNote":"string","suggestions":[{"title":"string","reason":"string","action":"string","priority":"Low|Medium|High","category":"food|hydration|sleep|activity|mood|maintenance"}]}',
        `Context: ${JSON.stringify(payload)}`,
      ].join("\n");
    case "budget":
      return [
        "You are KainWise, an AI wellness companion.",
        "Return JSON only.",
        "Suggest affordable healthy meals and grocery items, with a Filipino context when possible.",
        'Output shape: {"headline":"string","budgetNote":"string","meals":[{"name":"string","priceEstimatePhp":number,"nutrition":{"calories":number|null,"proteinGrams":number|null,"sodiumMg":number|null,"fiberGrams":number|null},"groceries":["string"],"why":"string"}],"groceryList":["string"]}',
        `Context: ${JSON.stringify(payload)}`,
      ].join("\n");
    case "workout":
      return [
        "You are KainWise, an AI wellness companion.",
        "Return JSON only.",
        "Suggest safe, practical workout or gym session ideas based on the profile, goals, budget, and available equipment.",
        "Keep it wellness-oriented and avoid medical diagnosis.",
        'Output shape: {"headline":"string","sessionNote":"string","workouts":[{"title":"string","workoutType":"string","durationMinutes":number,"intensity":"Low|Medium|High","equipment":["string"],"steps":["string"],"why":"string"}],"calendarNote":"string"}',
        `Context: ${JSON.stringify(payload)}`,
      ].join("\n");
    default:
      return [
        "You are KainWise, an AI wellness companion.",
        "Return JSON only.",
        `Context: ${JSON.stringify(payload)}`,
      ].join("\n");
  }
};
