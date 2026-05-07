const blockedPatterns = [
  /\b(?:porn|porno|pervert|pervy|sexchat|nudes?)\b/i,
  /\b(?:rape|molest|incest|bestiality)\b/i,
  /\b(?:kill|murder|bomb|terror|explosive)\b/i,
  /\b(?:drug\s*deal|meth|cocaine|heroin)\b/i,
  /\b(?:hack|phish|carding|fraud|counterfeit)\b/i,
];

const looksLikeGibberish = (text = "") => {
  const compact = String(text).replace(/\s+/g, "");
  if (compact.length < 12) return false;
  const vowels = (compact.match(/[aeiou]/gi) ?? []).length;
  const vowelRatio = vowels / compact.length;
  const longConsonantRun = /[bcdfghjklmnpqrstvwxyz]{7,}/i.test(compact);
  const lowReadableRatio = /^[a-z]+$/i.test(compact) && vowelRatio < 0.2;
  return longConsonantRun || lowReadableRatio;
};

export const detectUnsafeText = (value) => {
  const text = String(value ?? "").trim();
  if (!text) return null;
  if (blockedPatterns.some((pattern) => pattern.test(text))) {
    return "I can’t help with that. Please provide a safe, clear wellness or food-related input.";
  }
  if (looksLikeGibberish(text)) {
    return "I can’t help with that. Please provide a safe, clear wellness or food-related input.";
  }
  return null;
};

export const assertSafeTextFields = (entries = []) => {
  for (const entry of entries) {
    const message = detectUnsafeText(entry?.value);
    if (message) {
      const label = entry?.label ? `${entry.label}: ` : "";
      const error = new Error(`${label}${message}`);
      error.status = 400;
      throw error;
    }
  }
};
