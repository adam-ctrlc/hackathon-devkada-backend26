import ImageKit from "imagekit";
import { extname } from "node:path";
import { env } from "../../config/env.js";

const safeTrim = (value) => (typeof value === "string" ? value.trim() : "");

let imageKitClient = null;

const hasConfig = () =>
  Boolean(
    safeTrim(env.imageKitPublicKey) &&
    safeTrim(env.imageKitPrivateKey) &&
    safeTrim(env.imageKitUrlEndpoint),
  );

const getImageKitClient = () => {
  if (!hasConfig()) {
    return null;
  }

  if (imageKitClient) {
    return imageKitClient;
  }

  imageKitClient = new ImageKit({
    publicKey: safeTrim(env.imageKitPublicKey),
    privateKey: safeTrim(env.imageKitPrivateKey),
    urlEndpoint: safeTrim(env.imageKitUrlEndpoint),
  });

  return imageKitClient;
};

const normalizeFileName = ({ originalName, fallbackName, mimetype }) => {
  const rawName = safeTrim(originalName) || safeTrim(fallbackName) || "upload";
  const cleanName = rawName
    .replace(/[\\/]/g, "_")
    .replace(/[^a-zA-Z0-9._-]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "");
  const extension = extname(cleanName);

  if (extension) {
    return cleanName;
  }

  const inferredExtension = safeTrim(mimetype).startsWith("image/")
    ? ".jpg"
    : safeTrim(mimetype) === "application/pdf"
      ? ".pdf"
      : "";

  return `${cleanName || "upload"}${inferredExtension}`;
};

export const isImageKitConfigured = () => hasConfig();

const normalizeSegment = (value) =>
  safeTrim(value)
    .toLowerCase()
    .replace(/[\\/]/g, "-")
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "");

export const buildImageKitFolder = ({ profile, fileType }) => {
  const userName = [profile?.firstName, profile?.middleName, profile?.lastName]
    .map(normalizeSegment)
    .filter(Boolean)
    .join("-");
  const resolvedUserName =
    userName || `profile-${normalizeSegment(profile?.id) || "unknown"}`;
  const resolvedFileType = normalizeSegment(fileType) || "files";

  return `/kainwise/${resolvedUserName}/${resolvedFileType}`;
};

export const uploadMediaToImageKit = async ({
  buffer,
  originalName,
  fallbackName,
  mimetype,
  folder,
  tags,
}) => {
  if (!buffer?.length) {
    return null;
  }

  const client = getImageKitClient();
  if (!client) {
    return null;
  }

  const result = await client.upload({
    file: buffer,
    fileName: normalizeFileName({ originalName, fallbackName, mimetype }),
    folder: safeTrim(folder) || safeTrim(env.imageKitFolder) || "/",
    useUniqueFileName: true,
    tags,
  });

  return {
    fileId: result?.fileId ?? null,
    filePath: result?.filePath ?? null,
    url: result?.url ?? null,
    thumbnailUrl: result?.thumbnailUrl ?? null,
    name: result?.name ?? null,
    mimeType: mimetype ?? null,
  };
};
