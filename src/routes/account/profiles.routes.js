import { prisma } from "../../lib/prisma.js";
import { asyncHandler } from "../../utils/async-handler.js";
import {
  formatProfile,
  splitFullName,
  normalizeSex,
  buildDisplayName,
} from "../../services/profile/profile.service.js";
import {
  buildProfileMetrics,
  buildStatusRecommendation,
} from "../../services/wellness/analysis.service.js";
import crypto from "node:crypto";
import { authlessWriteLimiter } from "../../middleware/security.middleware.js";
import { requireProfileAccess } from "../../services/profile/profile-access.service.js";
import { rejectIfHoneypotHit } from "../../services/auth/honeypot.service.js";

const requireText = (value, field) => {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`${field} is required`);
  }
  return value.trim();
};

const hashPin = (pin) =>
  crypto.createHash("sha256").update(String(pin)).digest("hex");
const normalizeCurrency = (value) => {
  const text = String(value ?? "")
    .trim()
    .toUpperCase();
  return text.length === 3 ? text : null;
};
const normalizeRole = (value) => {
  const text = String(value ?? "")
    .trim()
    .toUpperCase();
  return ["ADMIN", "PARENT", "CHILD", "INDIVIDUAL", "CAREGIVER"].includes(text)
    ? text
    : "INDIVIDUAL";
};
const generateInviteCode = () =>
  crypto.randomBytes(6).toString("hex").toUpperCase();
const safeProfilePreview = {
  id: true,
  firstName: true,
  middleName: true,
  lastName: true,
  role: true,
};

const normalizeProfileNameInput = (payload = {}) => {
  if (payload.firstName || payload.lastName || payload.middleName) {
    return {
      firstName: String(payload.firstName ?? "").trim(),
      middleName: String(payload.middleName ?? "").trim() || null,
      lastName: String(payload.lastName ?? "").trim(),
    };
  }

  return splitFullName(payload.name);
};

const requireNameParts = (payload = {}) => {
  const { firstName, middleName, lastName } =
    normalizeProfileNameInput(payload);
  if (!firstName || !lastName) {
    throw new Error("firstName and lastName are required");
  }
  return { firstName, middleName, lastName };
};

const normalizeProfileSex = (value) => normalizeSex(value);

const profileSelect = {
  healthContext: true,
  parentProfile: { select: safeProfilePreview },
  children: { select: safeProfilePreview },
  sentInvites: { orderBy: { createdAt: "desc" }, take: 10 },
  receivedInvites: { orderBy: { createdAt: "desc" }, take: 10 },
  scans: { orderBy: { createdAt: "desc" }, take: 5 },
  diaryEntries: { orderBy: { createdAt: "desc" }, take: 5 },
  dailySummaries: { orderBy: { date: "desc" }, take: 7 },
};

export const registerProfileRoutes = (app) => {
  app.post(
    "/profiles",
    authlessWriteLimiter,
    asyncHandler(async (req, res) => {
      const payload = req.body ?? {};
      const honeypotError = rejectIfHoneypotHit(payload);
      if (honeypotError) {
        throw honeypotError;
      }
      const nameParts = requireNameParts(payload);
      const profile = await prisma.profile.create({
        data: {
          ...nameParts,
          role: normalizeRole(payload.role),
          age: payload.age ? Number(payload.age) : null,
          sex: normalizeProfileSex(payload.sex),
          heightCm: payload.heightCm ? Number(payload.heightCm) : null,
          weightKg: payload.weightKg ? Number(payload.weightKg) : null,
          activityLevel: payload.activityLevel?.trim() ?? null,
          healthGoal: payload.healthGoal?.trim() ?? null,
          incomeAmount:
            payload.incomeAmount !== undefined
              ? Number(payload.incomeAmount)
              : null,
          incomeFrequency: payload.incomeFrequency?.trim() ?? null,
          incomeCurrency: normalizeCurrency(payload.incomeCurrency),
          budgetAmount:
            payload.budgetAmount !== undefined
              ? Number(payload.budgetAmount)
              : null,
          budgetFrequency: payload.budgetFrequency?.trim() ?? null,
          budgetCurrency: normalizeCurrency(payload.budgetCurrency),
          parentProfileId: payload.parentProfileId?.trim() || null,
          allergies: Array.isArray(payload.allergies) ? payload.allergies : [],
          foodPreferences: Array.isArray(payload.foodPreferences)
            ? payload.foodPreferences
            : [],
          dietRestrictions: Array.isArray(payload.dietRestrictions)
            ? payload.dietRestrictions
            : [],
        },
      });

      res.status(201).json({
        profile: formatProfile(profile),
        metrics: buildProfileMetrics(profile),
      });
    }),
  );

  app.get(
    "/profiles/:profileId",
    asyncHandler(async (req, res) => {
      const profile = await prisma.profile.findUnique({
        where: { id: req.params.profileId },
        include: profileSelect,
      });

      if (!profile) {
        return res.status(404).json({ error: "Profile not found" });
      }

      const access = await requireProfileAccess(req, res, profile);
      if (!access.allowed) {
        return;
      }

      res.json({
        profile: formatProfile(profile),
        metrics: buildProfileMetrics(profile),
        recommendation: buildStatusRecommendation(
          profile.healthContext?.status,
        ),
      });
    }),
  );

  app.patch(
    "/profiles/:profileId",
    authlessWriteLimiter,
    asyncHandler(async (req, res) => {
      const payload = req.body ?? {};
      const profile = await prisma.profile.update({
        where: { id: req.params.profileId },
        data: {
          ...(payload.name !== undefined ||
          payload.firstName !== undefined ||
          payload.lastName !== undefined ||
          payload.middleName !== undefined
            ? requireNameParts(payload)
            : {}),
          role:
            payload.role !== undefined
              ? normalizeRole(payload.role)
              : undefined,
          age: payload.age !== undefined ? Number(payload.age) : undefined,
          sex:
            payload.sex !== undefined
              ? normalizeProfileSex(payload.sex)
              : undefined,
          heightCm:
            payload.heightCm !== undefined
              ? Number(payload.heightCm)
              : undefined,
          weightKg:
            payload.weightKg !== undefined
              ? Number(payload.weightKg)
              : undefined,
          activityLevel: payload.activityLevel?.trim(),
          healthGoal: payload.healthGoal?.trim(),
          incomeAmount:
            payload.incomeAmount !== undefined
              ? Number(payload.incomeAmount)
              : undefined,
          incomeFrequency: payload.incomeFrequency?.trim(),
          incomeCurrency:
            payload.incomeCurrency !== undefined
              ? normalizeCurrency(payload.incomeCurrency)
              : undefined,
          budgetAmount:
            payload.budgetAmount !== undefined
              ? Number(payload.budgetAmount)
              : undefined,
          budgetFrequency: payload.budgetFrequency?.trim(),
          budgetCurrency:
            payload.budgetCurrency !== undefined
              ? normalizeCurrency(payload.budgetCurrency)
              : undefined,
          parentProfileId:
            payload.parentProfileId !== undefined
              ? payload.parentProfileId?.trim() || null
              : undefined,
          allergies: Array.isArray(payload.allergies)
            ? payload.allergies
            : undefined,
          foodPreferences: Array.isArray(payload.foodPreferences)
            ? payload.foodPreferences
            : undefined,
          dietRestrictions: Array.isArray(payload.dietRestrictions)
            ? payload.dietRestrictions
            : undefined,
        },
      });

      res.json({ profile: formatProfile(profile) });
    }),
  );

  app.post(
    "/profiles/:profileId/diary-lock",
    authlessWriteLimiter,
    asyncHandler(async (req, res) => {
      const pin = requireText(req.body?.pin, "pin");

      const profile = await prisma.profile.update({
        where: { id: req.params.profileId },
        data: { diaryPinHash: hashPin(pin) },
      });

      res.json({ profile: formatProfile(profile), diaryLocked: true });
    }),
  );

  app.delete(
    "/profiles/:profileId/diary-lock",
    authlessWriteLimiter,
    asyncHandler(async (req, res) => {
      const profile = await prisma.profile.update({
        where: { id: req.params.profileId },
        data: { diaryPinHash: null },
      });

      res.json({ profile: formatProfile(profile), diaryLocked: false });
    }),
  );

  app.post(
    "/profiles/:profileId/invites",
    authlessWriteLimiter,
    asyncHandler(async (req, res) => {
      const payload = req.body ?? {};
      const inviter = await prisma.profile.findUnique({
        where: { id: req.params.profileId },
      });

      if (!inviter) {
        return res.status(404).json({ error: "Profile not found" });
      }

      if (
        !["ADMIN", "PARENT", "CAREGIVER"].includes(
          String(inviter.role ?? "").toUpperCase(),
        )
      ) {
        return res.status(403).json({
          error:
            "Only parent, caregiver, or admin accounts can invite child accounts",
        });
      }

      const invite = await prisma.accountInvite.create({
        data: {
          code: generateInviteCode(),
          inviterProfileId: inviter.id,
          invitedRole: normalizeRole(payload.invitedRole ?? "CHILD"),
          note: payload.note?.trim() ?? null,
        },
      });

      res.status(201).json({
        invite: {
          ...invite,
          inviterProfile: {
            id: inviter.id,
            name: buildDisplayName(inviter),
            role: inviter.role,
          },
        },
      });
    }),
  );

  app.post(
    "/profiles/invites/accept",
    authlessWriteLimiter,
    asyncHandler(async (req, res) => {
      const code = requireText(req.body?.code, "code");
      const childProfileId = requireText(
        req.body?.childProfileId,
        "childProfileId",
      );

      const invite = await prisma.accountInvite.findUnique({
        where: { code },
        include: {
          inviterProfile: { select: safeProfilePreview },
          inviteeProfile: { select: safeProfilePreview },
        },
      });

      if (!invite) {
        return res.status(404).json({ error: "Invite not found" });
      }

      if (invite.status !== "PENDING") {
        return res.status(409).json({ error: "Invite is no longer pending" });
      }

      const childProfile = await prisma.profile.findUnique({
        where: { id: childProfileId },
      });

      if (!childProfile) {
        return res.status(404).json({ error: "Child profile not found" });
      }

      if (
        childProfile.parentProfileId &&
        childProfile.parentProfileId !== invite.inviterProfileId
      ) {
        return res
          .status(409)
          .json({ error: "Child profile is already linked to another parent" });
      }

      const [updatedChild, updatedInvite] = await prisma.$transaction([
        prisma.profile.update({
          where: { id: childProfileId },
          data: {
            role: invite.invitedRole,
            parentProfileId: invite.inviterProfileId,
          },
        }),
        prisma.accountInvite.update({
          where: { code },
          data: {
            status: "ACCEPTED",
            inviteeProfileId: childProfileId,
            acceptedAt: new Date(),
          },
        }),
      ]);

      res.json({
        invite: updatedInvite,
        childProfile: formatProfile(updatedChild),
      });
    }),
  );

  app.get(
    "/profiles/:profileId/relations",
    asyncHandler(async (req, res) => {
      const profile = await prisma.profile.findUnique({
        where: { id: req.params.profileId },
        include: {
          parentProfile: { select: safeProfilePreview },
          children: { select: safeProfilePreview },
          sentInvites: { orderBy: { createdAt: "desc" }, take: 10 },
          receivedInvites: { orderBy: { createdAt: "desc" }, take: 10 },
        },
      });

      if (!profile) {
        return res.status(404).json({ error: "Profile not found" });
      }

      const access = await requireProfileAccess(req, res, profile);
      if (!access.allowed) {
        return;
      }

      res.json({
        parentProfile: profile.parentProfile,
        children: profile.children,
        sentInvites: profile.sentInvites,
        receivedInvites: profile.receivedInvites,
      });
    }),
  );
};
