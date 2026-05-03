const normalizeSex = (value) => {
  const text = String(value ?? "")
    .trim()
    .toUpperCase();
  return text === "FEMALE" ? "FEMALE" : "MALE";
};

const buildDisplayName = (profile) => {
  const parts = [profile?.firstName, profile?.middleName, profile?.lastName]
    .map((value) => String(value ?? "").trim())
    .filter(Boolean);
  if (parts.length) {
    return parts.join(" ");
  }

  return String(profile?.name ?? "").trim() || null;
};

export const formatProfile = (profile) => {
  if (!profile) {
    return null;
  }

  const {
    diaryPinHash,
    passwordHash,
    refreshTokenHash,
    resetTokenHash,
    resetTokenExpiresAt,
    ...safeProfile
  } = profile;
  const normalizeAccountRole = (value) => {
    const text = String(value ?? "")
      .trim()
      .toUpperCase();
    return ["ADMIN", "PARENT", "CHILD", "INDIVIDUAL", "CAREGIVER"].includes(
      text,
    )
      ? text
      : "INDIVIDUAL";
  };
  const fullName = buildDisplayName(profile);

  return {
    ...safeProfile,
    name: fullName,
    role: normalizeAccountRole(profile.role),
    sex: normalizeSex(profile.sex),
    firstName: String(profile.firstName ?? "").trim(),
    middleName: String(profile.middleName ?? "").trim() || null,
    lastName: String(profile.lastName ?? "").trim(),
    fullName,
    allergies: Array.isArray(profile.allergies) ? profile.allergies : [],
    foodPreferences: Array.isArray(profile.foodPreferences)
      ? profile.foodPreferences
      : [],
    dietRestrictions: Array.isArray(profile.dietRestrictions)
      ? profile.dietRestrictions
      : [],
  };
};

export const splitFullName = (input) => {
  const text = String(input ?? "")
    .trim()
    .replace(/\s+/g, " ");
  if (!text) {
    return { firstName: "", middleName: null, lastName: "" };
  }

  const parts = text.split(" ");
  if (parts.length === 1) {
    return { firstName: parts[0], middleName: null, lastName: parts[0] };
  }

  if (parts.length === 2) {
    return { firstName: parts[0], middleName: null, lastName: parts[1] };
  }

  return {
    firstName: parts[0],
    middleName: parts.slice(1, -1).join(" "),
    lastName: parts[parts.length - 1],
  };
};

export { buildDisplayName, normalizeSex };
