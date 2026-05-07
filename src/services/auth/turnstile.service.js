import { env } from "../../config/env.js";

const TURNSTILE_VERIFY_URL =
  "https://challenges.cloudflare.com/turnstile/v0/siteverify";

const safeTrim = (value) => (typeof value === "string" ? value.trim() : "");

const createError = (message, status) => {
  const error = new Error(message);
  error.status = status;
  return error;
};

const getTurnstileTokenFromPayload = (payload = {}) =>
  safeTrim(
    payload.turnstileToken ??
      payload.turnstile ??
      payload.cfTurnstileResponse ??
      payload["cf-turnstile-response"],
  );

export const verifyTurnstileToken = async ({ token, remoteIp } = {}) => {
  const secret = safeTrim(env.turnstileSecretKey);
  if (!secret) {
    return { enabled: false, verified: true };
  }

  const responseToken = safeTrim(token);
  if (!responseToken) {
    throw createError("Turnstile token is required", 400);
  }

  const body = new URLSearchParams({
    secret,
    response: responseToken,
  });

  if (safeTrim(remoteIp)) {
    body.set("remoteip", safeTrim(remoteIp));
  }

  let response;
  try {
    response = await fetch(TURNSTILE_VERIFY_URL, {
      method: "POST",
      body,
      signal: AbortSignal.timeout(8000),
    });
  } catch {
    // Cloudflare unreachable (network error, timeout) — fail open
    return { enabled: true, verified: true, skipped: true };
  }

  if (!response.ok) {
    throw createError("Turnstile verification service unavailable", 502);
  }

  const result = await response.json();
  if (!result?.success) {
    throw createError("Turnstile verification failed", 400);
  }

  return {
    enabled: true,
    verified: true,
    challengeTs: result.challenge_ts ?? null,
    hostname: result.hostname ?? null,
    action: result.action ?? null,
    cdata: result.cdata ?? null,
  };
};

export const requireTurnstileVerification = async (payload, remoteIp) =>
  verifyTurnstileToken({
    token: getTurnstileTokenFromPayload(payload),
    remoteIp,
  });
