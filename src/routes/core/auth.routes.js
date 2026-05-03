import { prisma } from "../../lib/prisma.js";
import { asyncHandler } from "../../utils/async-handler.js";
import { authlessWriteLimiter } from "../../middleware/security.middleware.js";
import { rejectIfHoneypotHit } from "../../services/auth/honeypot.service.js";
import {
  getAuthProfileSelect,
  hashPassword,
  hashToken,
  issueAuthTokens,
  issueResetToken,
  normalizeAuthEmail,
  sanitizeAuthProfile,
  verifyPassword,
  verifyAccessToken,
  verifyRefreshToken,
  verifyResetToken,
} from "../../services/auth/auth.service.js";
import { requireTurnstileVerification } from "../../services/auth/turnstile.service.js";

const requireText = (value, field) => {
  if (typeof value !== "string" || !value.trim()) {
    const error = new Error(`${field} is required`);
    error.status = 400;
    throw error;
  }

  return value.trim();
};

const normalizeNameParts = (payload = {}) => {
  const firstName = requireText(payload.firstName, "firstName");
  const lastName = requireText(payload.lastName, "lastName");
  const middleName = String(payload.middleName ?? "").trim() || null;
  return { firstName, middleName, lastName };
};

const buildProfileData = (payload = {}) => ({
  ...normalizeNameParts(payload),
  email: normalizeAuthEmail(payload.email) || null,
  role: payload.role?.trim()?.toUpperCase() || "INDIVIDUAL",
  sex: payload.sex?.trim()?.toUpperCase() === "FEMALE" ? "FEMALE" : "MALE",
  age: payload.age !== undefined ? Number(payload.age) : null,
  heightCm: payload.heightCm !== undefined ? Number(payload.heightCm) : null,
  weightKg: payload.weightKg !== undefined ? Number(payload.weightKg) : null,
  activityLevel: payload.activityLevel?.trim() || null,
  healthGoal: payload.healthGoal?.trim() || null,
  parentProfileId: payload.parentProfileId?.trim() || null,
  incomeAmount:
    payload.incomeAmount !== undefined ? Number(payload.incomeAmount) : null,
  incomeFrequency: payload.incomeFrequency?.trim() || null,
  incomeCurrency:
    String(payload.incomeCurrency ?? "")
      .trim()
      .toUpperCase() || null,
  budgetAmount:
    payload.budgetAmount !== undefined ? Number(payload.budgetAmount) : null,
  budgetFrequency: payload.budgetFrequency?.trim() || null,
  budgetCurrency:
    String(payload.budgetCurrency ?? "")
      .trim()
      .toUpperCase() || null,
  allergies: Array.isArray(payload.allergies) ? payload.allergies : [],
  foodPreferences: Array.isArray(payload.foodPreferences)
    ? payload.foodPreferences
    : [],
  dietRestrictions: Array.isArray(payload.dietRestrictions)
    ? payload.dietRestrictions
    : [],
});

const setRefreshToken = async (profileId, refreshToken) => {
  await prisma.profile.update({
    where: { id: profileId },
    data: { refreshTokenHash: hashToken(refreshToken) },
  });
};

export const registerAuthRoutes = (app) => {
  app.post(
    "/auth/register",
    authlessWriteLimiter,
    asyncHandler(async (req, res) => {
      const payload = req.body ?? {};
      const honeypotError = rejectIfHoneypotHit(payload);
      if (honeypotError) {
        throw honeypotError;
      }
      await requireTurnstileVerification(payload, req.ip);
      const email = normalizeAuthEmail(payload.email);
      const password = requireText(payload.password, "password");

      if (!email) {
        return res.status(400).json({ error: "email is required" });
      }

      const existing = await prisma.profile.findUnique({
        where: { email },
        select: { id: true },
      });

      if (existing) {
        return res.status(409).json({ error: "Email already in use" });
      }

      const profile = await prisma.profile.create({
        data: {
          ...buildProfileData(payload),
          email,
          passwordHash: await hashPassword(password),
        },
        select: getAuthProfileSelect,
      });

      const tokens = issueAuthTokens({ profile });
      await setRefreshToken(profile.id, tokens.refreshToken);

      res.status(201).json({
        profile: sanitizeAuthProfile(profile),
        tokens,
      });
    }),
  );

  app.post(
    "/auth/login",
    authlessWriteLimiter,
    asyncHandler(async (req, res) => {
      const payload = req.body ?? {};
      const honeypotError = rejectIfHoneypotHit(payload);
      if (honeypotError) {
        throw honeypotError;
      }
      await requireTurnstileVerification(payload, req.ip);
      const email = normalizeAuthEmail(payload.email);
      const password = requireText(payload.password, "password");

      if (!email) {
        return res.status(400).json({ error: "email is required" });
      }

      const profile = await prisma.profile.findUnique({
        where: { email },
        select: getAuthProfileSelect,
      });

      if (!profile || !(await verifyPassword(password, profile.passwordHash))) {
        return res.status(401).json({ error: "Invalid email or password" });
      }

      const tokens = issueAuthTokens({ profile });
      await prisma.profile.update({
        where: { id: profile.id },
        data: {
          refreshTokenHash: hashToken(tokens.refreshToken),
          lastLoginAt: new Date(),
        },
      });

      res.json({
        profile: sanitizeAuthProfile(profile),
        tokens,
      });
    }),
  );

  app.post(
    "/auth/refresh",
    authlessWriteLimiter,
    asyncHandler(async (req, res) => {
      const honeypotError = rejectIfHoneypotHit(req.body ?? {});
      if (honeypotError) {
        throw honeypotError;
      }
      const refreshToken = requireText(req.body?.refreshToken, "refreshToken");
      const decoded = verifyRefreshToken(refreshToken);

      const profile = await prisma.profile.findUnique({
        where: { id: String(decoded.sub ?? "") },
        select: getAuthProfileSelect,
      });

      if (!profile || profile.refreshTokenHash !== hashToken(refreshToken)) {
        return res.status(401).json({ error: "Invalid refresh token" });
      }

      const tokens = issueAuthTokens({ profile });
      await prisma.profile.update({
        where: { id: profile.id },
        data: { refreshTokenHash: hashToken(tokens.refreshToken) },
      });

      res.json({ tokens });
    }),
  );

  app.post(
    "/auth/password-reset/request",
    authlessWriteLimiter,
    asyncHandler(async (req, res) => {
      const honeypotError = rejectIfHoneypotHit(req.body ?? {});
      if (honeypotError) {
        throw honeypotError;
      }
      const email = normalizeAuthEmail(req.body?.email);
      if (!email) {
        return res.status(400).json({ error: "email is required" });
      }

      const profile = await prisma.profile.findUnique({
        where: { email },
        select: getAuthProfileSelect,
      });

      if (!profile) {
        return res.json({ ok: true });
      }

      const reset = issueResetToken({ profile });
      await prisma.profile.update({
        where: { id: profile.id },
        data: {
          resetTokenHash: reset.resetTokenHash,
          resetTokenExpiresAt: new Date(Date.now() + 30 * 60 * 1000),
        },
      });

      res.json({
        ok: true,
        resetToken: reset.resetToken,
        resetTokenExpiresIn: reset.resetTokenExpiresIn,
      });
    }),
  );

  app.post(
    "/auth/password-reset/confirm",
    authlessWriteLimiter,
    asyncHandler(async (req, res) => {
      const honeypotError = rejectIfHoneypotHit(req.body ?? {});
      if (honeypotError) {
        throw honeypotError;
      }
      const resetToken = requireText(req.body?.resetToken, "resetToken");
      const newPassword = requireText(req.body?.newPassword, "newPassword");
      const decoded = verifyResetToken(resetToken);
      const profileId = String(decoded.sub ?? "");

      const profile = await prisma.profile.findUnique({
        where: { id: profileId },
        select: getAuthProfileSelect,
      });

      if (
        !profile ||
        profile.resetTokenHash !== hashToken(resetToken) ||
        !profile.resetTokenExpiresAt ||
        profile.resetTokenExpiresAt.getTime() < Date.now()
      ) {
        return res.status(401).json({ error: "Invalid reset token" });
      }

      await prisma.profile.update({
        where: { id: profile.id },
        data: {
          passwordHash: await hashPassword(newPassword),
          refreshTokenHash: null,
          resetTokenHash: null,
          resetTokenExpiresAt: null,
        },
      });

      res.json({ ok: true });
    }),
  );

  app.get(
    "/auth/me",
    asyncHandler(async (req, res) => {
      const authHeader = String(req.get("authorization") ?? "").trim();
      const token = authHeader.startsWith("Bearer ")
        ? authHeader.slice(7).trim()
        : "";

      if (!token) {
        return res.status(401).json({ error: "Authorization token required" });
      }

      const decoded = verifyAccessToken(token);
      const profile = await prisma.profile.findUnique({
        where: { id: String(decoded.sub ?? "") },
        select: getAuthProfileSelect,
      });

      if (!profile) {
        return res.status(404).json({ error: "Profile not found" });
      }

      res.json({ profile: sanitizeAuthProfile(profile) });
    }),
  );
};
