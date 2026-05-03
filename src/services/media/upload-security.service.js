import { fileTypeFromBuffer } from "file-type";

const allowedMimeTypes = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/heic",
  "image/heif",
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "text/plain",
]);

const suspiciousPatterns = [
  /<script[\s>]/i,
  /javascript:/i,
  /powershell/i,
  /cmd\.exe/i,
  /\b(vba|macro|activex)\b/i,
  /\beval\s*\(/i,
  /\bcreateobject\s*\(/i,
  /\bshell\s*\(/i,
  /\bonerror\s*=/i,
  /\bonload\s*=/i,
  /\/js/i,
];

const normalize = (value) =>
  String(value ?? "")
    .trim()
    .toLowerCase();

export const hasSuspiciousContent = (text) => {
  const value = String(text ?? "");
  return suspiciousPatterns.some((pattern) => pattern.test(value));
};

const toUtf8Text = (buffer) => {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(buffer);
  } catch {
    return null;
  }
};

export const inspectUploadBuffer = async ({ buffer, mimetype }) => {
  if (!buffer?.length) {
    return { allowed: false, reason: "Empty file" };
  }

  const detected = await fileTypeFromBuffer(buffer);
  const detectedMime = normalize(detected?.mime);
  const declaredMime = normalize(mimetype);
  const effectiveMime = detectedMime || declaredMime;

  if (!effectiveMime || !allowedMimeTypes.has(effectiveMime)) {
    return {
      allowed: false,
      reason: "Unsupported file type",
      detectedMime,
      declaredMime,
    };
  }

  if (detectedMime && declaredMime && detectedMime !== declaredMime) {
    return {
      allowed: false,
      reason: "MIME mismatch",
      detectedMime,
      declaredMime,
    };
  }

  const rawScan = buffer.toString("latin1");
  if (hasSuspiciousContent(rawScan)) {
    return {
      allowed: false,
      reason: "Suspicious file content",
      detectedMime,
      declaredMime,
    };
  }

  if (effectiveMime === "text/plain") {
    const utf8Text = toUtf8Text(buffer);
    if (utf8Text === null) {
      return {
        allowed: false,
        reason: "Invalid text encoding",
        detectedMime,
        declaredMime,
      };
    }

    if (hasSuspiciousContent(utf8Text)) {
      return {
        allowed: false,
        reason: "Suspicious text content",
        detectedMime,
        declaredMime,
      };
    }
  }

  return {
    allowed: true,
    detectedMime,
    declaredMime,
    effectiveMime,
  };
};

export const scanUploadTextForThreats = (text) => {
  const normalized = String(text ?? "");
  if (!normalized.trim()) {
    return { allowed: true };
  }

  if (hasSuspiciousContent(normalized)) {
    return { allowed: false, reason: "Suspicious extracted content" };
  }

  return { allowed: true };
};
