import { prisma } from "../../lib/prisma.js";
import { asyncHandler } from "../../utils/async-handler.js";
import {
  formatProfile,
  splitFullName,
  normalizeSex,
  buildDisplayName,
} from "../../services/profile/profile.service.js";
import {
  normalizeAuthUsername,
  verifyPassword,
} from "../../services/auth/auth.service.js";
import {
  buildProfileMetrics,
  buildStatusRecommendation,
} from "../../services/wellness/analysis.service.js";
import crypto from "node:crypto";
import { authlessWriteLimiter } from "../../middleware/security.middleware.js";
import { requireProfileAccess } from "../../services/profile/profile-access.service.js";
import { rejectIfHoneypotHit } from "../../services/auth/honeypot.service.js";
import { assertSafeTextFields } from "../../services/safety/text-safety.service.js";
import { validateBody } from "../../validation/validate.js";
import {
  diaryPinBodySchema,
  diaryPinResetBodySchema,
  inviteAcceptBodySchema,
  inviteCreateBodySchema,
  profileCreateBodySchema,
  profileUpdateBodySchema,
} from "../../validation/account/profile.schema.js";

const hashPin = (pin) =>
  crypto.createHash("sha256").update(String(pin)).digest("hex");
const diaryLockSelect = {
  id: true,
  role: true,
  parentProfileId: true,
  diaryPinHash: true,
  passwordHash: true,
};
const buildDiaryLockState = (profile) => ({
  diaryLocked: Boolean(profile?.diaryPinHash),
});
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
  username: true,
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
const findProfileByUsername = (username, profileId) =>
  prisma.profile.findFirst({
    where: profileId ? { username, NOT: { id: profileId } } : { username },
    select: { id: true },
  });

const profileSelect = {
  id: true,
  email: true,
  username: true,
  firstName: true,
  middleName: true,
  lastName: true,
  role: true,
  age: true,
  sex: true,
  heightCm: true,
  weightKg: true,
  activityLevel: true,
  healthGoal: true,
  dietPattern: true,
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
      const rawPayload = req.body ?? {};
      const honeypotError = rejectIfHoneypotHit(rawPayload);
      if (honeypotError) {
        throw honeypotError;
      }
      const payload = validateBody(profileCreateBodySchema, rawPayload);
      const nameParts = requireNameParts(payload);
      const username = normalizeAuthUsername(payload.username);
      if (username) {
        const existingUsername = await findProfileByUsername(username);
        if (existingUsername) {
          return res.status(409).json({ error: "Username already in use" });
        }
      }
      assertSafeTextFields([
        { label: "First name", value: nameParts.firstName },
        { label: "Middle name", value: nameParts.middleName },
        { label: "Last name", value: nameParts.lastName },
        { label: "Health goal", value: payload.healthGoal },
      ]);

      const createParentId = payload.parentProfileId?.trim() || null;
      if (createParentId) {
        const parentExists = await prisma.profile.findUnique({
          where: { id: createParentId },
          select: { id: true },
        });
        if (!parentExists) {
          return res
            .status(400)
            .json({ error: "parentProfileId does not exist" });
        }
      }

      const profile = await prisma.profile.create({
        data: {
          ...nameParts,
          username: username || null,
          role: normalizeRole(payload.role),
          age: payload.age ? Number(payload.age) : null,
          sex: normalizeProfileSex(payload.sex),
          heightCm: payload.heightCm ? Number(payload.heightCm) : null,
          weightKg: payload.weightKg ? Number(payload.weightKg) : null,
          activityLevel: payload.activityLevel?.trim() ?? null,
          healthGoal: payload.healthGoal?.trim() ?? null,
          dietPattern: payload.dietPattern?.trim() ?? null,
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
          parentProfileId: createParentId,
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
        select: profileSelect,
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
      const payload = validateBody(profileUpdateBodySchema, req.body);
      const profileMeta = await prisma.profile.findUnique({
        where: { id: req.params.profileId },
        select: { id: true, role: true, parentProfileId: true },
      });

      if (!profileMeta) {
        return res.status(404).json({ error: "Profile not found" });
      }

      const access = await requireProfileAccess(req, res, profileMeta);
      if (!access.allowed) {
        return;
      }

      if (payload.username !== undefined) {
        const username = normalizeAuthUsername(payload.username);
        if (username) {
          const existingUsername = await findProfileByUsername(
            username,
            req.params.profileId,
          );
          if (existingUsername) {
            return res.status(409).json({ error: "Username already in use" });
          }
        }
      }
      assertSafeTextFields([
        { label: "First name", value: payload.firstName ?? payload.name },
        { label: "Middle name", value: payload.middleName },
        { label: "Last name", value: payload.lastName },
        { label: "Health goal", value: payload.healthGoal },
        { label: "Activity level", value: payload.activityLevel },
      ]);

      if (payload.parentProfileId !== undefined) {
        const newParentId = payload.parentProfileId?.trim() || null;
        if (newParentId) {
          if (newParentId === req.params.profileId) {
            return res
              .status(400)
              .json({ error: "Profile cannot be its own parent" });
          }
          const parentExists = await prisma.profile.findUnique({
            where: { id: newParentId },
            select: { id: true },
          });
          if (!parentExists) {
            return res
              .status(400)
              .json({ error: "parentProfileId does not exist" });
          }
        }
      }

      const profile = await prisma.profile.update({
        where: { id: req.params.profileId },
        data: {
          ...(payload.name !== undefined ||
          payload.firstName !== undefined ||
          payload.lastName !== undefined ||
          payload.middleName !== undefined
            ? requireNameParts(payload)
            : {}),
          username:
            payload.username !== undefined
              ? normalizeAuthUsername(payload.username) || null
              : undefined,
          email:
            payload.email !== undefined
              ? String(payload.email ?? "")
                  .trim()
                  .toLowerCase() || null
              : undefined,
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
          dietPattern: payload.dietPattern?.trim(),
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
      const profile = await prisma.profile.findUnique({
        where: { id: req.params.profileId },
        select: diaryLockSelect,
      });

      if (!profile) {
        return res.status(404).json({ error: "Profile not found" });
      }

      const access = await requireProfileAccess(req, res, profile);
      if (!access.allowed) {
        return;
      }

      const { pin } = validateBody(diaryPinBodySchema, req.body);
      const updated = await prisma.profile.update({
        where: { id: profile.id },
        data: { diaryPinHash: hashPin(pin) },
      });

      res.status(profile.diaryPinHash ? 200 : 201).json({
        profile: formatProfile(updated),
        ...buildDiaryLockState(updated),
      });
    }),
  );

  app.put(
    "/profiles/:profileId/diary-lock",
    authlessWriteLimiter,
    asyncHandler(async (req, res) => {
      const profile = await prisma.profile.findUnique({
        where: { id: req.params.profileId },
        select: diaryLockSelect,
      });

      if (!profile) {
        return res.status(404).json({ error: "Profile not found" });
      }

      const access = await requireProfileAccess(req, res, profile);
      if (!access.allowed) {
        return;
      }

      const { pin } = validateBody(diaryPinBodySchema, req.body);
      const updated = await prisma.profile.update({
        where: { id: profile.id },
        data: { diaryPinHash: hashPin(pin) },
      });

      res.json({
        profile: formatProfile(updated),
        ...buildDiaryLockState(updated),
      });
    }),
  );

  app.post(
    "/profiles/:profileId/diary-lock/reset",
    authlessWriteLimiter,
    asyncHandler(async (req, res) => {
      const profile = await prisma.profile.findUnique({
        where: { id: req.params.profileId },
        select: diaryLockSelect,
      });

      if (!profile) {
        return res.status(404).json({ error: "Profile not found" });
      }

      const access = await requireProfileAccess(req, res, profile);
      if (!access.allowed) {
        return;
      }

      const { password, pin } = validateBody(diaryPinResetBodySchema, req.body);

      const passwordMatches = await verifyPassword(
        password,
        profile.passwordHash,
      );
      if (!passwordMatches) {
        return res.status(401).json({ error: "Password is incorrect" });
      }

      const updated = await prisma.profile.update({
        where: { id: profile.id },
        data: { diaryPinHash: hashPin(pin) },
      });

      res.json({
        profile: formatProfile(updated),
        ...buildDiaryLockState(updated),
      });
    }),
  );

  app.delete(
    "/profiles/:profileId/diary-lock",
    authlessWriteLimiter,
    asyncHandler(async (req, res) => {
      const profile = await prisma.profile.findUnique({
        where: { id: req.params.profileId },
        select: diaryLockSelect,
      });

      if (!profile) {
        return res.status(404).json({ error: "Profile not found" });
      }

      const access = await requireProfileAccess(req, res, profile);
      if (!access.allowed) {
        return;
      }

      const updated = await prisma.profile.update({
        where: { id: profile.id },
        data: { diaryPinHash: null },
      });

      res.json({ profile: formatProfile(updated), diaryLocked: false });
    }),
  );

  app.get(
    "/profiles/:profileId/diary-lock",
    asyncHandler(async (req, res) => {
      const profile = await prisma.profile.findUnique({
        where: { id: req.params.profileId },
        select: diaryLockSelect,
      });

      if (!profile) {
        return res.status(404).json({ error: "Profile not found" });
      }

      const access = await requireProfileAccess(req, res, profile);
      if (!access.allowed) {
        return;
      }

      res.json(buildDiaryLockState(profile));
    }),
  );

  app.post(
    "/profiles/:profileId/invites",
    authlessWriteLimiter,
    asyncHandler(async (req, res) => {
      const payload = validateBody(inviteCreateBodySchema, req.body);
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
      const { code, childProfileId } = validateBody(
        inviteAcceptBodySchema,
        req.body,
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
