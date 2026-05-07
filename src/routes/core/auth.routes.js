import { prisma } from "../../lib/prisma.js";
import { asyncHandler } from "../../utils/async-handler.js";
import { authlessWriteLimiter } from "../../middleware/security.middleware.js";
import { rejectIfHoneypotHit } from "../../services/auth/honeypot.service.js";
import {
  generateEmailVerifyCode,
  getAuthProfileSelect,
  hashPassword,
  hashToken,
  issueAuthTokens,
  issueResetToken,
  normalizeAuthEmail,
  normalizeAuthUsername,
  sanitizeAuthProfile,
  verifyPassword,
  verifyAccessToken,
  verifyRefreshToken,
  verifyResetToken,
} from "../../services/auth/auth.service.js";
import { requireTurnstileVerification } from "../../services/auth/turnstile.service.js";
import {
  sendEmailVerificationEmail,
  sendPasswordResetEmail,
} from "../../services/auth/email.service.js";
import { validateBody } from "../../validation/validate.js";
import {
  authLoginBodySchema,
  authRefreshBodySchema,
  authRegisterBodySchema,
  emailVerifyBodySchema,
  emailResendVerifyBodySchema,
  passwordResetConfirmBodySchema,
  passwordResetRequestBodySchema,
} from "../../validation/core/auth.schema.js";

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

const normalizeIdentifier = (value) => {
  const text = String(value ?? "").trim();
  if (!text) {
    return "";
  }

  return text.includes("@")
    ? normalizeAuthEmail(text)
    : normalizeAuthUsername(text);
};

const buildProfileData = (payload = {}) => ({
  ...normalizeNameParts(payload),
  email: normalizeAuthEmail(payload.email) || null,
  username: normalizeAuthUsername(payload.username) || null,
  role: payload.role?.trim()?.toUpperCase() || "INDIVIDUAL",
  sex: payload.sex?.trim()?.toUpperCase() === "FEMALE" ? "FEMALE" : "MALE",
  age: payload.age !== undefined ? Number(payload.age) : null,
  heightCm: payload.heightCm !== undefined ? Number(payload.heightCm) : null,
  weightKg: payload.weightKg !== undefined ? Number(payload.weightKg) : null,
  activityLevel: payload.activityLevel?.trim() || null,
  healthGoal: payload.healthGoal?.trim() || null,
  dietPattern: payload.dietPattern?.trim() || null,
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
      const rawPayload = req.body ?? {};
      const honeypotError = rejectIfHoneypotHit(rawPayload);
      if (honeypotError) {
        throw honeypotError;
      }
      const payload = validateBody(authRegisterBodySchema, rawPayload);
      await requireTurnstileVerification(payload, req.ip);
      const email = normalizeAuthEmail(payload.email);
      const username = normalizeAuthUsername(payload.username);
      const password = payload.password;

      const [emailOwner, usernameOwner] = await Promise.all([
        prisma.profile.findFirst({
          where: { email },
          select: { id: true, emailVerified: true },
        }),
        prisma.profile.findFirst({
          where: { username },
          select: { id: true, email: true, emailVerified: true },
        }),
      ]);

      if (emailOwner?.emailVerified) {
        return res.status(409).json({ error: "Email is already in use" });
      }

      if (
        usernameOwner &&
        usernameOwner.email !== email &&
        (usernameOwner.emailVerified || !emailOwner)
      ) {
        return res.status(409).json({ error: "Username is already in use" });
      }

      const verifyCode = generateEmailVerifyCode();
      const verifyExpiresAt = new Date(Date.now() + 30 * 60 * 1000);

      const profileData = {
        ...buildProfileData(payload),
        email,
        passwordHash: await hashPassword(password),
        emailVerified: false,
        emailVerifyCode: hashToken(verifyCode),
        emailVerifyExpiresAt: verifyExpiresAt,
      };

      const profile = emailOwner
        ? await prisma.profile.update({
            where: { id: emailOwner.id },
            data: profileData,
            select: getAuthProfileSelect,
          })
        : await prisma.profile.create({
            data: profileData,
            select: getAuthProfileSelect,
          });

      sendEmailVerificationEmail({
        toEmail: email,
        code: verifyCode,
        firstName: profile.firstName,
      }).catch((err) => {
        console.error("[email] verification send failed:", err);
      });

      res.status(201).json({ requiresVerification: true, email });
    }),
  );

  app.post(
    "/auth/verify-email",
    authlessWriteLimiter,
    asyncHandler(async (req, res) => {
      const payload = validateBody(emailVerifyBodySchema, req.body ?? {});
      const email = normalizeAuthEmail(payload.email);
      const codeHash = hashToken(payload.code.trim());

      const profile = await prisma.profile.findFirst({
        where: { email },
        select: getAuthProfileSelect,
      });

      if (!profile) {
        return res.status(404).json({ error: "Account not found" });
      }

      if (profile.emailVerified) {
        return res.status(409).json({ error: "Email is already verified" });
      }

      if (
        profile.emailVerifyCode !== codeHash ||
        !profile.emailVerifyExpiresAt ||
        new Date() > profile.emailVerifyExpiresAt
      ) {
        return res
          .status(400)
          .json({ error: "Invalid or expired verification code" });
      }

      const verified = await prisma.profile.update({
        where: { id: profile.id },
        data: {
          emailVerified: true,
          emailVerifyCode: null,
          emailVerifyExpiresAt: null,
          lastLoginAt: new Date(),
        },
        select: getAuthProfileSelect,
      });

      const tokens = issueAuthTokens({ profile: verified });
      await setRefreshToken(verified.id, tokens.refreshToken);

      res.json({ profile: sanitizeAuthProfile(verified), tokens });
    }),
  );

  app.post(
    "/auth/resend-verify",
    authlessWriteLimiter,
    asyncHandler(async (req, res) => {
      const payload = validateBody(emailResendVerifyBodySchema, req.body ?? {});
      const email = normalizeAuthEmail(payload.email);

      const profile = await prisma.profile.findFirst({
        where: { email },
        select: { id: true, email: true, firstName: true, emailVerified: true },
      });

      if (!profile || profile.emailVerified) {
        return res.json({ ok: true });
      }

      const verifyCode = generateEmailVerifyCode();
      const verifyExpiresAt = new Date(Date.now() + 30 * 60 * 1000);

      await prisma.profile.update({
        where: { id: profile.id },
        data: {
          emailVerifyCode: hashToken(verifyCode),
          emailVerifyExpiresAt: verifyExpiresAt,
        },
      });

      sendEmailVerificationEmail({
        toEmail: email,
        code: verifyCode,
        firstName: profile.firstName,
      }).catch((err) => {
        console.error("[email] verification send failed:", err);
      });

      res.json({ ok: true });
    }),
  );

  app.post(
    "/auth/login",
    authlessWriteLimiter,
    asyncHandler(async (req, res) => {
      const rawPayload = req.body ?? {};
      const honeypotError = rejectIfHoneypotHit(rawPayload);
      if (honeypotError) {
        throw honeypotError;
      }
      const payload = validateBody(authLoginBodySchema, rawPayload);
      await requireTurnstileVerification(payload, req.ip);
      const identifier = normalizeIdentifier(
        payload.identifier ?? payload.email ?? payload.username,
      );
      const password = payload.password;

      const profile = await prisma.profile.findFirst({
        where: {
          OR: [{ email: identifier }, { username: identifier }],
        },
        select: getAuthProfileSelect,
      });

      if (!profile || !(await verifyPassword(password, profile.passwordHash))) {
        return res
          .status(401)
          .json({ error: "Invalid email/username or password" });
      }

      if (!profile.emailVerified) {
        return res.status(403).json({
          error: "Please verify your email before signing in",
          code: "EMAIL_NOT_VERIFIED",
          email: profile.email,
        });
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
      const { refreshToken } = validateBody(authRefreshBodySchema, req.body);
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
      const payload = validateBody(passwordResetRequestBodySchema, req.body);
      const email = normalizeAuthEmail(payload.email);
      await requireTurnstileVerification(payload, req.ip);

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

      sendPasswordResetEmail({
        toEmail: profile.email,
        resetToken: reset.resetToken,
        firstName: profile.firstName,
      }).catch((err) =>
        console.error("[email] Failed to send reset email:", err.message),
      );

      res.json({ ok: true });
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
      const { resetToken, newPassword, ...payload } = validateBody(
        passwordResetConfirmBodySchema,
        req.body,
      );
      await requireTurnstileVerification(
        { resetToken, newPassword, ...payload },
        req.ip,
      );
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
