import { z } from "zod";

const emptyToUndefined = (value) =>
  value === "" || value === null ? undefined : value;

const optionalTrimmedString = (max = 255) =>
  z.preprocess(emptyToUndefined, z.string().trim().max(max).optional());

const optionalPositiveNumber = z.preprocess(
  emptyToUndefined,
  z.coerce.number().finite().positive().optional(),
);

const optionalHeightCm = z.preprocess(
  emptyToUndefined,
  z.coerce.number().finite().min(10).max(300).optional(),
);

const optionalWeightKg = z.preprocess(
  emptyToUndefined,
  z.coerce.number().finite().min(0.5).max(600).optional(),
);

const optionalInt = z.preprocess(
  emptyToUndefined,
  z.coerce.number().int().min(1).max(130).finite().optional(),
);

const tagList = z.preprocess(
  (value) => (Array.isArray(value) ? value : undefined),
  z.array(z.string().trim().min(1).max(80)).max(50).optional(),
);

const currencyCode = z.preprocess(
  emptyToUndefined,
  z
    .string()
    .trim()
    .length(3)
    .transform((value) => value.toUpperCase())
    .optional(),
);

const profileBodySchema = z
  .object({
    name: optionalTrimmedString(),
    firstName: optionalTrimmedString(),
    middleName: optionalTrimmedString(),
    lastName: optionalTrimmedString(),
    username: optionalTrimmedString(80),
    role: optionalTrimmedString(40),
    age: optionalInt,
    sex: optionalTrimmedString(20),
    heightCm: optionalHeightCm,
    weightKg: optionalWeightKg,
    activityLevel: optionalTrimmedString(80),
    healthGoal: optionalTrimmedString(255),
    dietPattern: optionalTrimmedString(80),
    incomeAmount: optionalPositiveNumber,
    incomeFrequency: optionalTrimmedString(40),
    incomeCurrency: currencyCode,
    budgetAmount: optionalPositiveNumber,
    budgetFrequency: optionalTrimmedString(40),
    budgetCurrency: currencyCode,
    parentProfileId: optionalTrimmedString(80),
    allergies: tagList,
    foodPreferences: tagList,
    dietRestrictions: tagList,
  })
  .passthrough();

export const profileCreateBodySchema = profileBodySchema.superRefine(
  (value, context) => {
    const hasSplitName = Boolean(value.firstName && value.lastName);
    const hasFullName = Boolean(value.name);
    if (!hasSplitName && !hasFullName) {
      context.addIssue({
        code: "custom",
        path: ["firstName"],
        message: "First and last name are required",
      });
    }
  },
);

export const profileUpdateBodySchema = profileBodySchema.partial();

export const diaryPinBodySchema = z.object({
  pin: z
    .string()
    .trim()
    .regex(/^\d{4,8}$/, {
      message: "PIN must be 4 to 8 digits",
    }),
});

export const diaryPinResetBodySchema = diaryPinBodySchema.extend({
  password: z.string().min(1, "Password is required"),
});

export const inviteCreateBodySchema = z
  .object({
    invitedRole: optionalTrimmedString(40),
    note: optionalTrimmedString(500),
  })
  .passthrough();

export const inviteAcceptBodySchema = z.object({
  code: z.string().trim().min(1, "Invite code is required"),
  childProfileId: z.string().trim().min(1, "Child profile is required"),
});
