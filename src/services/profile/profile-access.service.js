import { prisma } from "../../lib/prisma.js";

const normalizeRole = (value) =>
  String(value ?? "")
    .trim()
    .toUpperCase();

export const getViewerProfileId = (req) =>
  String(
    req.authProfile?.id ??
      req.headers["x-viewer-profile-id"] ??
      req.query.viewerProfileId ??
      req.body?.viewerProfileId ??
      "",
  ).trim() || null;

export const loadViewerProfile = async (viewerProfileId) => {
  if (!viewerProfileId) {
    return null;
  }

  return prisma.profile.findUnique({
    where: { id: viewerProfileId },
    select: { id: true, role: true },
  });
};

export const canViewProfile = ({ viewerProfile, targetProfile }) => {
  if (!targetProfile) {
    return { allowed: false, reason: "Profile not found" };
  }

  if (!viewerProfile) {
    return { allowed: true, reason: "Legacy self-access" };
  }

  if (viewerProfile.id === targetProfile.id) {
    return { allowed: true, reason: "Self access" };
  }

  const viewerRole = normalizeRole(viewerProfile.role);
  if (viewerRole === "ADMIN") {
    return { allowed: true, reason: "Admin access" };
  }

  if (
    ["PARENT", "CAREGIVER"].includes(viewerRole) &&
    targetProfile.parentProfileId === viewerProfile.id
  ) {
    return { allowed: true, reason: "Linked family access" };
  }

  return { allowed: false, reason: "Not authorized to view this profile" };
};

export const requireProfileAccess = async (req, res, targetProfile) => {
  const viewerProfileId = getViewerProfileId(req);
  const viewerProfile = await loadViewerProfile(viewerProfileId);
  const access = canViewProfile({ viewerProfile, targetProfile });

  if (!access.allowed) {
    const status = access.reason === "Profile not found" ? 404 : 403;
    res.status(status).json({ error: access.reason });
    return { allowed: false, viewerProfile, viewerProfileId, access };
  }

  return { allowed: true, viewerProfile, viewerProfileId, access };
};
