import { z } from "zod";

const emptyToUndefined = (value) =>
  value === "" || value === null ? undefined : value;

const optionalText = (max = 255) =>
  z.preprocess(emptyToUndefined, z.string().trim().max(max).optional());

const emailAddress = z.string().trim().email("Enter a valid email address");

const gmailAddress = emailAddress.refine(
  (value) => value.toLowerCase().split("@").pop() === "gmail.com",
  "Use a Gmail address",
);

const optionalNumber = z.preprocess(
  emptyToUndefined,
  z.coerce.number().finite().nonnegative().optional(),
);

const optionalInt = z.preprocess(
  emptyToUndefined,
  z.coerce.number().int().min(0).max(130).finite().optional(),
);

const tagList = z.preprocess(
  (value) => (Array.isArray(value) ? value : undefined),
  z.array(z.string().trim().min(1).max(80)).optional(),
);

export const authRegisterBodySchema = z
  .object({
    firstName: z.string().trim().min(1, "First name is required").max(120),
    middleName: optionalText(120),
    lastName: z.string().trim().min(1, "Last name is required").max(120),
    email: gmailAddress,
    username: z.string().trim().min(3).max(80),
    password: z.string().min(8, "Password must be at least 8 characters"),
    role: optionalText(40),
    sex: optionalText(20),
    age: optionalInt,
    heightCm: optionalNumber,
    weightKg: optionalNumber,
    activityLevel: optionalText(80),
    healthGoal: optionalText(255),
    dietPattern: optionalText(80),
    parentProfileId: optionalText(80),
    incomeAmount: optionalNumber,
    incomeFrequency: optionalText(40),
    incomeCurrency: optionalText(3),
    budgetAmount: optionalNumber,
    budgetFrequency: optionalText(40),
    budgetCurrency: optionalText(3),
    allergies: tagList,
    foodPreferences: tagList,
    dietRestrictions: tagList,
  })
  .passthrough();

export const authLoginBodySchema = z
  .object({
    identifier: optionalText(255),
    email: optionalText(255),
    username: optionalText(80),
    password: z.string().min(1, "Password is required"),
  })
  .passthrough()
  .refine((value) => value.identifier || value.email || value.username, {
    message: "Email or username is required",
    path: ["identifier"],
  });

export const authRefreshBodySchema = z.object({
  refreshToken: z.string().trim().min(1, "Refresh token is required"),
});

export const emailVerifyBodySchema = z
  .object({
    email: z.string().trim().email("Enter a valid email address"),
    code: z.string().trim().min(1, "Verification code is required"),
  })
  .passthrough();

export const emailResendVerifyBodySchema = z
  .object({
    email: z.string().trim().email("Enter a valid email address"),
  })
  .passthrough();

export const passwordResetRequestBodySchema = z
  .object({
    email: gmailAddress,
  })
  .passthrough();

export const passwordResetConfirmBodySchema = z
  .object({
    resetToken: z.string().trim().min(1, "Reset token is required"),
    newPassword: z.string().min(8, "Password must be at least 8 characters"),
  })
  .passthrough();
