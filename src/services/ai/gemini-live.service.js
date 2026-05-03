import { env } from "../../config/env.js";

const safeTrim = (value) => (typeof value === "string" ? value.trim() : "");

const defaultModel = "gemini-3.1-flash-live-preview";

const redact = (value) => {
  const text = safeTrim(value);
  if (!text) {
    return "";
  }

  if (text.length <= 12) {
    return "[redacted]";
  }

  return `${text.slice(0, 6)}...[redacted]...${text.slice(-4)}`;
};

let sdkCache = null;

const getSDK = async (apiKey) => {
  if (sdkCache?.apiKey === apiKey) {
    return sdkCache.client;
  }

  const { GoogleGenAI } = await import("@google/genai");
  const client = new GoogleGenAI({
    apiKey,
    httpOptions: { apiVersion: "v1alpha" },
  });
  sdkCache = { apiKey, client };
  return client;
};

export const createGeminiEphemeralToken = async ({
  model,
  config = {},
} = {}) => {
  const apiKey = safeTrim(env.geminiApiKey || process.env.GOOGLE_API_KEY);
  if (!apiKey) {
    const err = new Error("GEMINI_API_KEY is not configured");
    err.status = 500;
    throw err;
  }

  const resolvedModel = safeTrim(model) || defaultModel;
  const resolvedTemperature = Number.isFinite(Number(config.temperature))
    ? Number(config.temperature)
    : 0.5;
  const expireTime = new Date(Date.now() + 30 * 60 * 1000).toISOString();
  const newSessionExpireTime = new Date(Date.now() + 60 * 1000).toISOString();

  console.log("gemini.token.create.begin", {
    model: resolvedModel,
    temperature: resolvedTemperature,
    expireTime,
    newSessionExpireTime,
    constraints: "unlocked",
    apiKey: redact(apiKey),
  });

  const client = await getSDK(apiKey);
  const create = client.authTokens?.create || client.tokens?.create;

  if (!create) {
    const err = new Error("@google/genai does not expose authTokens.create()");
    err.status = 500;
    throw err;
  }

  try {
    const token = await create.call(client.authTokens || client.tokens, {
      config: {
        uses: 1,
        expireTime,
        newSessionExpireTime,
        httpOptions: { apiVersion: "v1alpha" },
      },
    });

    if (!token?.name) {
      const err = new Error(
        "Gemini token response did not include a token name",
      );
      err.status = 502;
      err.details = token;
      throw err;
    }

    console.log("gemini.token.create.success", {
      token: redact(token.name),
      expireTime: token.expireTime,
      newSessionExpireTime: token.newSessionExpireTime,
    });

    return {
      token: token.name,
      expireTime: token.expireTime || expireTime,
      newSessionExpireTime,
      model: resolvedModel,
    };
  } catch (error) {
    console.error("gemini.token.create.error", {
      message: error.message,
      status: error.status,
      code: error.code,
      details: error.details || error.response,
    });

    error.status = error.status || 502;
    throw error;
  }
};
