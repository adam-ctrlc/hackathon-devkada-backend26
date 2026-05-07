import { prisma, dbConnected } from "../lib/prisma.js";
import {
  verifyAccessToken,
  verifyRefreshToken,
} from "../services/auth/auth.service.js";

const getBearerToken = (req) => {
  const authHeader = String(req.get("authorization") ?? "").trim();
  if (!authHeader.toLowerCase().startsWith("bearer ")) {
    return null;
  }

  return authHeader.slice(7).trim() || null;
};

const loadAuthProfile = async (profileId) =>
  prisma.profile.findUnique({
    where: { id: profileId },
    select: { id: true, role: true, email: true, username: true },
  });

export const jwtContextMiddleware = async (req, res, next) => {
  const token = getBearerToken(req);
  if (!token) {
    return next();
  }

  try {
    const decoded = verifyAccessToken(token);
    const profileId = String(decoded.sub ?? "").trim();
    if (!profileId) {
      return next();
    }

    const authProfile = await loadAuthProfile(profileId);
    if (authProfile) {
      req.authProfile = authProfile;
      req.authToken = token;
      req.authTokenPayload = decoded;
    }

    return next();
  } catch {
    // access token failed, try refresh token
  }

  try {
    const decoded = verifyRefreshToken(token);
    const profileId = String(decoded.sub ?? "").trim();
    if (!profileId) {
      return next();
    }

    const authProfile = await loadAuthProfile(profileId);
    if (authProfile) {
      req.authProfile = authProfile;
      req.authToken = token;
      req.authTokenPayload = decoded;
      req.authViaRefresh = true;
    }

    return next();
  } catch {
    req.authTokenInvalid = true;
  }

  return next();
};

export const requireAuth = (req, res, next) => {
  if (!req.authProfile) {
    return res.status(401).json({ error: "Authentication required" });
  }

  return next();
};

export const requireDatabase = (req, res, next) => {
  if (!dbConnected) {
    return res.status(503).json({ error: "Database unavailable" });
  }

  return next();
};
