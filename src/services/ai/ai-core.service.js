import { env } from "../../config/env.js";
import { buildPrompt } from "./ai-prompts.service.js";
import { GoogleGenAI, Modality } from "@google/genai";

const logPreviewLimit = 3000;

const previewValue = (value, limit = logPreviewLimit) => {
  try {
    const text =
      typeof value === "string" ? value : JSON.stringify(value, null, 2);
    if (!text) {
      return "";
    }

    return text.length > limit
      ? `${text.slice(0, limit)}... [truncated ${text.length - limit} chars]`
      : text;
  } catch {
    return "[unserializable]";
  }
};

const logGemini = (event, details = {}) => {
  console.log(`gemini.${event}`, {
    at: new Date().toISOString(),
    ...details,
  });
};

const normalizeText = (value) =>
  String(value ?? "")
    .trim()
    .toLowerCase();
const normalizeSex = (value) => {
  const text = String(value ?? "")
    .trim()
    .toUpperCase();
  if (["FEMALE", "F", "WOMAN", "GIRL"].includes(text)) return "female";
  return "male";
};

export const buildProfileSignals = (profile = {}, healthContext = null) => {
  const signals = [];
  switch (
    String(profile.role ?? "")
      .trim()
      .toUpperCase()
  ) {
    case "PARENT":
      signals.push("This account is set up as a parent account.");
      break;
    case "CHILD":
      signals.push("This account is set up as a child account.");
      break;
    case "CAREGIVER":
      signals.push("This account is set up as a caregiver account.");
      break;
    case "ADMIN":
      signals.push("This account is set up as an admin account.");
      break;
    default:
      break;
  }
  const age = Number(profile.age);

  switch (true) {
    case Number.isFinite(age) && age < 18:
      signals.push(
        "You are in a younger age group, so growth and energy needs may matter more.",
      );
      break;
    case Number.isFinite(age) && age >= 50:
      signals.push(
        "You are in an older age group, so steady energy, protein, and hydration may matter more.",
      );
      break;
    case Number.isFinite(age) && age >= 18:
      signals.push(
        "You are in an adult age group, so balance and consistency matter more.",
      );
      break;
    default:
      break;
  }

  switch (normalizeSex(profile.sex)) {
    case "male":
      signals.push("Your profile uses a male sex marker.");
      break;
    case "female":
      signals.push("Your profile uses a female sex marker.");
      break;
    default:
      break;
  }

  switch (normalizeText(profile.activityLevel)) {
    case "sedentary":
      signals.push(
        "Your activity level is low, so lighter portions may fit better.",
      );
      break;
    case "light":
      signals.push(
        "Your activity level is light, so steady meals may help maintain energy.",
      );
      break;
    case "moderate":
      signals.push(
        "Your activity level is moderate, so balanced protein and carbs may fit well.",
      );
      break;
    case "active":
    case "very active":
      signals.push(
        "Your activity level is high, so recovery foods and hydration may matter more.",
      );
      break;
    default:
      break;
  }

  const goal = normalizeText(profile.healthGoal);
  switch (true) {
    case goal.includes("lose weight"):
      signals.push("Your goal leans toward weight loss.");
      break;
    case goal.includes("gain weight"):
      signals.push("Your goal leans toward weight gain.");
      break;
    case goal.includes("build muscle"):
      signals.push("Your goal leans toward muscle building.");
      break;
    case goal.includes("improve energy"):
      signals.push("Your goal leans toward better energy.");
      break;
    case goal.includes("reduce sugar"):
      signals.push("Your goal leans toward reducing sugar.");
      break;
    default:
      break;
  }

  const restrictionSources = [
    ...(Array.isArray(profile.dietRestrictions)
      ? profile.dietRestrictions
      : []),
    ...(Array.isArray(profile.allergies) ? profile.allergies : []),
  ];

  for (const item of restrictionSources) {
    const text = normalizeText(item);
    if (text) {
      signals.push(`Restriction noted: ${item}.`);
    }
  }

  const status = normalizeText(healthContext?.status);
  switch (true) {
    case status.includes("pregnant"):
      signals.push("Current health status is pregnancy.");
      break;
    case status.includes("surgery"):
      signals.push("Current health status is surgery recovery.");
      break;
    case status.includes("flu"):
    case status.includes("fever"):
    case status.includes("cold"):
    case status.includes("ill"):
    case status.includes("sick"):
      signals.push("Current health status suggests illness recovery.");
      break;
    case status.includes("period"):
      signals.push("Current health status is menstruation support.");
      break;
    default:
      break;
  }

  return signals;
};

export const buildProfileContext = (profile = {}, healthContext = null) => ({
  age: profile?.age ?? null,
  sex: profile?.sex ?? null,
  role: profile?.role ?? "INDIVIDUAL",
  heightCm: profile?.heightCm ?? null,
  weightKg: profile?.weightKg ?? null,
  activityLevel: profile?.activityLevel ?? null,
  healthGoal: profile?.healthGoal ?? null,
  allergies: profile?.allergies ?? [],
  foodPreferences: profile?.foodPreferences ?? [],
  dietRestrictions: profile?.dietRestrictions ?? [],
  healthStatus: healthContext?.status ?? null,
  signals: buildProfileSignals(profile, healthContext),
});

export const safeJsonParse = (value) => {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
};

const extractFirstJsonValue = (text) => {
  const source = String(text ?? "").trim();
  if (!source) {
    return "";
  }

  const openingIndex = source.search(/[{\[]/);
  if (openingIndex === -1) {
    return source;
  }

  const stack = [];
  let inString = false;
  let isEscaped = false;

  for (let index = openingIndex; index < source.length; index += 1) {
    const char = source[index];

    if (inString) {
      if (isEscaped) {
        isEscaped = false;
        continue;
      }

      if (char === "\\") {
        isEscaped = true;
        continue;
      }

      if (char === '"') {
        inString = false;
      }
      continue;
    }

    if (char === '"') {
      inString = true;
      continue;
    }

    if (char === "{" || char === "[") {
      stack.push(char);
      continue;
    }

    if (char === "}" || char === "]") {
      const last = stack.at(-1);
      const matches =
        (char === "}" && last === "{") || (char === "]" && last === "[");
      if (!matches) {
        break;
      }

      stack.pop();
      if (stack.length === 0) {
        return source.slice(openingIndex, index + 1);
      }
    }
  }

  return source;
};

const runStandardGemini = async ({ kind, payload, options = {} }) => {
  const startedAt = Date.now();
  const client = new GoogleGenAI({ apiKey: env.geminiApiKey });

  const parts = [];
  if (options.image?.data && options.image?.mimeType) {
    parts.push({
      inlineData: {
        mimeType: options.image.mimeType,
        data: options.image.data,
      },
    });
  }

  if (Array.isArray(options.parts)) {
    parts.push(...options.parts);
  }

  const prompt = buildPrompt({ kind, payload });
  parts.push({ text: prompt });

  logGemini("request", {
    kind,
    model: GEMINI_STANDARD_MODEL,
    mode: "standard",
    timeoutMs: options.timeoutMs ?? 60000,
    hasImage: Boolean(options.image?.data && options.image?.mimeType),
    payloadPreview: previewValue(payload),
    promptPreview: previewValue(prompt),
  });

  const result = await client.models.generateContent({
    model: GEMINI_STANDARD_MODEL,
    contents: [{ role: "user", parts }],
    config: {
      systemInstruction:
        options.systemInstruction ??
        "Return valid JSON only. No markdown, no code fences, no extra text.",
      temperature: options.temperature ?? 0.4,
    },
  });

  const responseText = result?.text ?? "";
  const parsed = safeJsonParse(extractFirstJsonValue(responseText));

  logGemini("response", {
    kind,
    mode: "standard",
    elapsedMs: Date.now() - startedAt,
    responsePreview: previewValue(responseText),
    parsed: Boolean(parsed),
  });

  if (!parsed) {
    throw new Error("Gemini did not return valid JSON");
  }

  return { source: "gemini", ...parsed };
};

const runLiveGemini = async ({ kind, payload, options = {} }) => {
  const startedAt = Date.now();
  const client = new GoogleGenAI({
    apiKey: env.geminiApiKey,
    httpOptions: { apiVersion: "v1alpha" },
  });

  const parts = [];
  if (options.image?.data && options.image?.mimeType) {
    parts.push({
      inlineData: {
        mimeType: options.image.mimeType,
        data: options.image.data,
      },
    });
  }

  if (Array.isArray(options.parts)) {
    parts.push(...options.parts);
  }

  const prompt = buildPrompt({ kind, payload });
  parts.push({ text: prompt });

  logGemini("request", {
    kind,
    model: env.geminiLiveModel,
    timeoutMs: options.timeoutMs ?? 120000,
    hasImage: Boolean(options.image?.data && options.image?.mimeType),
    extraParts: Array.isArray(options.parts) ? options.parts.length : 0,
    payloadPreview: previewValue(payload),
    promptPreview: previewValue(prompt),
  });

  const chunks = [];
  const responseText = await new Promise(async (resolve, reject) => {
    let session;
    const timeoutId = setTimeout(() => {
      session?.close();
      reject(new Error(`Gemini live session timed out for ${kind}`));
    }, options.timeoutMs ?? 120000);

    const finish = (callback) => {
      clearTimeout(timeoutId);
      session?.close();
      callback();
    };

    try {
      session = await client.live.connect({
        model: env.geminiLiveModel,
        config: {
          responseModalities: [Modality.AUDIO],
          outputAudioTranscription: {},
          systemInstruction:
            options.systemInstruction ??
            "Return valid JSON only. No markdown, no code fences, no extra text.",
          temperature: options.temperature ?? 0.4,
        },
        callbacks: {
          onmessage: (message) => {
            if (message?.serverContent?.outputTranscription?.text) {
              chunks.push(message.serverContent.outputTranscription.text);
            }

            const modelParts = message?.serverContent?.modelTurn?.parts ?? [];
            for (const part of modelParts) {
              if (part?.text) {
                chunks.push(part.text);
              }
            }

            if (
              message?.serverContent?.turnComplete ||
              message?.serverContent?.generationComplete
            ) {
              finish(() => resolve(chunks.join("")));
            }
          },
          onerror: (event) => {
            finish(() =>
              reject(new Error(event?.message ?? "Gemini live session error")),
            );
          },
          onclose: (event) => {
            if (!chunks.length && !event?.wasClean) {
              finish(() =>
                reject(
                  new Error(
                    event?.reason ??
                      "Gemini live session closed before response",
                  ),
                ),
              );
            }
          },
        },
      });

      session.sendClientContent({
        turns: [
          {
            role: "user",
            parts,
          },
        ],
        turnComplete: true,
      });
    } catch (error) {
      session?.close();
      reject(error);
    }
  });

  const parsed = safeJsonParse(extractFirstJsonValue(responseText));
  logGemini("response", {
    kind,
    elapsedMs: Date.now() - startedAt,
    responsePreview: previewValue(responseText),
    parsed: Boolean(parsed),
  });

  if (!parsed) {
    throw new Error("Gemini did not return valid JSON");
  }

  return { source: "gemini", ...parsed };
};

export const callGemini = async (kind, payload, options = {}) => {
  if (!env.geminiApiKey) {
    logGemini("skip", {
      kind,
      reason: "GEMINI_API_KEY is not configured",
    });
    return null;
  }

  const hasImage = Boolean(options.image?.data && options.image?.mimeType);

  try {
    if (hasImage) {
      return await runLiveGemini({ kind, payload, options });
    }
    return await runStandardGemini({ kind, payload, options });
  } catch (error) {
    logGemini("error", {
      kind,
      message: error?.message ?? "Unknown Gemini error",
      name: error?.name,
      stack: env.nodeEnv === "development" ? error?.stack : undefined,
    });
    throw error;
  }
};
