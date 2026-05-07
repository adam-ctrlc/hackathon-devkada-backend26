import crypto from "node:crypto";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { env } from "../../config/env.js";

const normalizeEmail = (value) =>
  String(value ?? "")
    .trim()
    .toLowerCase();

const normalizeUsername = (value) =>
  String(value ?? "")
    .trim()
    .toLowerCase();

const safeTrim = (value) => (typeof value === "string" ? value.trim() : "");

const requireSecret = (value, name) => {
  const secret = safeTrim(value);
  if (!secret) {
    const error = new Error(`${name} is not configured`);
    error.status = 500;
    throw error;
  }
  return secret;
};

export const generateEmailVerifyCode = () =>
  crypto.randomInt(100000, 999999).toString();

export const hashPassword = async (password) =>
  bcrypt.hash(String(password), 10);

export const verifyPassword = async (password, hash) => {
  if (!hash) {
    return false;
  }

  return bcrypt.compare(String(password), String(hash));
};

export const hashToken = (token) =>
  crypto.createHash("sha256").update(String(token)).digest("hex");

const signToken = (payload, secret, expiresIn) =>
  jwt.sign(payload, requireSecret(secret, "JWT secret"), {
    expiresIn,
  });

export const issueAuthTokens = ({ profile }) => {
  const payload = {
    sub: profile.id,
    email: profile.email ?? null,
    username: profile.username ?? null,
    role: profile.role ?? "INDIVIDUAL",
  };

  const accessToken = signToken(payload, env.jwtAccessSecret, env.jwtAccessTtl);
  const refreshToken = signToken(
    payload,
    env.jwtRefreshSecret,
    env.jwtRefreshTtl,
  );

  return {
    accessToken,
    refreshToken,
    accessTokenExpiresIn: env.jwtAccessTtl,
    refreshTokenExpiresIn: env.jwtRefreshTtl,
  };
};

export const issueResetToken = ({ profile }) => {
  const token = signToken(
    { sub: profile.id, email: profile.email ?? null, type: "reset" },
    env.jwtResetSecret,
    env.jwtResetTtl,
  );

  return {
    resetToken: token,
    resetTokenExpiresIn: env.jwtResetTtl,
    resetTokenHash: hashToken(token),
  };
};

export const verifyAccessToken = (token) =>
  jwt.verify(
    String(token),
    requireSecret(env.jwtAccessSecret, "JWT_ACCESS_SECRET"),
  );

export const verifyRefreshToken = (token) =>
  jwt.verify(
    String(token),
    requireSecret(env.jwtRefreshSecret, "JWT_REFRESH_SECRET"),
  );

export const verifyResetToken = (token) =>
  jwt.verify(
    String(token),
    requireSecret(env.jwtResetSecret, "JWT_RESET_SECRET"),
  );

export const getAuthProfileSelect = {
  id: true,
  email: true,
  username: true,
  passwordHash: true,
  refreshTokenHash: true,
  resetTokenHash: true,
  resetTokenExpiresAt: true,
  emailVerified: true,
  emailVerifyCode: true,
  emailVerifyExpiresAt: true,
  lastLoginAt: true,
  role: true,
  firstName: true,
  middleName: true,
  lastName: true,
  sex: true,
  age: true,
  heightCm: true,
  weightKg: true,
  activityLevel: true,
  healthGoal: true,
  diaryPinHash: true,
  parentProfileId: true,
  incomeAmount: true,
  incomeFrequency: true,
  incomeCurrency: true,
  budgetAmount: true,
  budgetFrequency: true,
  budgetCurrency: true,
  allergies: true,
  foodPreferences: true,
  dietRestrictions: true,
  createdAt: true,
  updatedAt: true,
};

export const sanitizeAuthProfile = (profile) => {
  if (!profile) {
    return null;
  }

  const {
    diaryPinHash,
    passwordHash,
    refreshTokenHash,
    resetTokenHash,
    resetTokenExpiresAt,
    emailVerifyCode,
    emailVerifyExpiresAt,
    ...safeProfile
  } = profile;

  return {
    ...safeProfile,
    diaryLocked: Boolean(profile.diaryPinHash),
  };
};

export const normalizeAuthEmail = normalizeEmail;
export const normalizeAuthUsername = normalizeUsername;
