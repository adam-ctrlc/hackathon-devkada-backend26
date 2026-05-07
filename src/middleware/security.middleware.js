import crypto from "node:crypto";
import rateLimit from "express-rate-limit";
import { env } from "../config/env.js";

const isSafeMethod = (method) =>
  ["GET", "HEAD", "OPTIONS"].includes(String(method ?? "").toUpperCase());
const normalize = (value) =>
  String(value ?? "")
    .trim()
    .toLowerCase();

const createLimiter = ({ windowMs, limit, message }) =>
  rateLimit({
    windowMs,
    limit,
    standardHeaders: "draft-7",
    legacyHeaders: false,
    handler: (req, res) => {
      const resetTime = req.rateLimit?.resetTime
        ? new Date(req.rateLimit.resetTime).getTime()
        : Date.now() + windowMs;
      const retryAfterSeconds = Math.max(
        1,
        Math.ceil((resetTime - Date.now()) / 1000),
      );

      res.setHeader("Retry-After", String(retryAfterSeconds));
      res.status(429).json({
        error: message,
        code: "RATE_LIMITED",
        retryAfterSeconds,
      });
    },
  });

const csrfCookieName = env.csrfCookieName;
const csrfHeaderName = env.csrfHeaderName;

const getCookieOptions = () => ({
  httpOnly: true,
  sameSite: "lax",
  secure: env.nodeEnv === "production",
  path: "/",
});

const signToken = (secret, nonce) =>
  crypto.createHmac("sha256", secret).update(nonce).digest("hex");

export const issueCsrfToken = (req, res) => {
  const secret =
    req.cookies?.[csrfCookieName] ?? crypto.randomBytes(32).toString("hex");
  const nonce = crypto.randomBytes(16).toString("hex");
  const token = `${nonce}.${signToken(secret, nonce)}`;

  res.cookie(csrfCookieName, secret, getCookieOptions());
  res.json({ csrfToken: token, headerName: csrfHeaderName });
};

export const rejectInvalidJwt = (req, res, next) => {
  if (req.authTokenInvalid) {
    return res.status(401).json({ error: "Invalid authorization token" });
  }

  return next();
};

export const csrfProtection = (req, res, next) => {
  if (isSafeMethod(req.method)) {
    return next();
  }

  if (
    normalize(req.path).startsWith("/security/csrf") ||
    normalize(req.path).startsWith("/gemini-token") ||
    normalize(req.path).startsWith("/auth")
  ) {
    return next();
  }

  const secret = req.cookies?.[csrfCookieName];
  const token = req.get(csrfHeaderName) ?? req.get("x-csrf-token");

  if (!secret || !token) {
    return res.status(403).json({ error: "CSRF token required" });
  }

  const [nonce, signature] = String(token).split(".");
  if (!nonce || !signature) {
    return res.status(403).json({ error: "Invalid CSRF token" });
  }

  const expected = signToken(secret, nonce);
  const valid =
    signature.length === expected.length &&
    crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected));

  if (!valid) {
    return res.status(403).json({ error: "Invalid CSRF token" });
  }

  return next();
};

export const globalRateLimiter = createLimiter({
  windowMs: env.rateLimitWindowMs,
  limit: env.rateLimitGlobalMax,
  message: "Too many requests",
});

export const authlessWriteLimiter = createLimiter({
  windowMs: env.rateLimitWindowMs,
  limit: env.rateLimitWriteMax,
  message: "Too many write requests",
});

export const aiRouteLimiter = createLimiter({
  windowMs: env.rateLimitWindowMs,
  limit: env.rateLimitAiMax,
  message: "Too many AI requests",
});

export const scanRouteLimiter = createLimiter({
  windowMs: env.rateLimitWindowMs,
  limit: env.rateLimitScanMax,
  message: "Too many scan requests",
});

export const uploadRouteLimiter = createLimiter({
  windowMs: env.rateLimitWindowMs,
  limit: env.rateLimitUploadMax,
  message: "Too many upload requests",
});

export const taskRouteLimiter = createLimiter({
  windowMs: env.rateLimitWindowMs,
  limit: env.rateLimitTaskMax,
  message: "Too many task requests",
});
