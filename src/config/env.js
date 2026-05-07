import "dotenv/config";

const toNumber = (value, fallback) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

const toList = (value, fallback) =>
  String(value ?? "")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean)
    .reduce((acc, entry) => {
      if (!acc.includes(entry)) {
        acc.push(entry);
      }
      return acc;
    }, fallback.slice());

export const env = {
  nodeEnv: process.env.NODE_ENV ?? "development",
  port: toNumber(process.env.PORT, 3000),
  databaseUrl: process.env.DATABASE_URL ?? "file:./prisma/dev.db",
  corsOrigins: toList(
    [process.env.FRONTEND_ORIGIN, process.env.CORS_ORIGINS]
      .filter(Boolean)
      .join(","),
    ["http://localhost:5173", "http://127.0.0.1:5173"],
  ),
  geminiApiKey: process.env.GEMINI_API_KEY ?? "",
  geminiLiveModel:
    process.env.GEMINI_LIVE_MODEL ?? "gemini-3.1-flash-live-preview",
  jwtAccessSecret: process.env.JWT_ACCESS_SECRET ?? "",
  jwtRefreshSecret: process.env.JWT_REFRESH_SECRET ?? "",
  jwtResetSecret: process.env.JWT_RESET_SECRET ?? "",
  turnstileSecretKey:
    process.env.TURNSTILE_SECRET_KEY ??
    process.env.CLOUDFLARE_TURNSTILE_SECRET_KEY ??
    process.env.CF_TURNSTILE_SECRET_KEY ??
    "",
  jwtAccessTtl: process.env.JWT_ACCESS_TTL ?? "15m",
  jwtRefreshTtl: process.env.JWT_REFRESH_TTL ?? "30d",
  jwtResetTtl: process.env.JWT_RESET_TTL ?? "30m",
  imageKitPublicKey: process.env.IMAGEKIT_PUBLIC_KEY ?? "",
  imageKitPrivateKey: process.env.IMAGEKIT_PRIVATE_KEY ?? "",
  imageKitUrlEndpoint: process.env.IMAGEKIT_URL_ENDPOINT ?? "",
  imageKitFolder: process.env.IMAGEKIT_FOLDER ?? "/kainwise",
  openFoodFactsApiBaseUrl:
    process.env.OPEN_FOOD_FACTS_API_BASE_URL ??
    "https://world.openfoodfacts.org",
  openFoodFactsUserAgent:
    process.env.OPEN_FOOD_FACTS_USER_AGENT ?? "KainWise/1.0",
  openFoodFactsPageSize: toNumber(process.env.OPEN_FOOD_FACTS_PAGE_SIZE, 5),
  barcodeApiBaseUrl:
    process.env.BARCODE_API_BASE_URL ??
    process.env.OPEN_FOOD_FACTS_API_BASE_URL ??
    "https://world.openfoodfacts.org",
  barcodeApiUserAgent:
    process.env.BARCODE_API_USER_AGENT ??
    process.env.OPEN_FOOD_FACTS_USER_AGENT ??
    "KainWise/1.0",
  ocrLanguage: process.env.OCR_LANGUAGE ?? "eng",
  ocrMaxFileSizeMb: toNumber(process.env.OCR_MAX_FILE_SIZE_MB, 8),
  ocrSpaceApiKey:
    process.env.OCR_SPACE_API_KEY ?? process.env.OCR_API_KEY ?? "",
  ocrSpaceEndpoint:
    process.env.OCR_SPACE_ENDPOINT ?? "https://api.ocr.space/parse/image",
  geminiEmbeddingModel:
    process.env.GEMINI_EMBEDDING_MODEL ?? "gemini-embedding-2",
  rateLimitWindowMs: toNumber(process.env.RATE_LIMIT_WINDOW_MS, 15 * 60 * 1000),
  rateLimitGlobalMax: toNumber(process.env.RATE_LIMIT_GLOBAL_MAX, 100),
  rateLimitWriteMax: toNumber(process.env.RATE_LIMIT_WRITE_MAX, 30),
  rateLimitAiMax: toNumber(process.env.RATE_LIMIT_AI_MAX, 10),
  rateLimitScanMax: toNumber(process.env.RATE_LIMIT_SCAN_MAX, 12),
  rateLimitUploadMax: toNumber(process.env.RATE_LIMIT_UPLOAD_MAX, 6),
  rateLimitTaskMax: toNumber(process.env.RATE_LIMIT_TASK_MAX, 15),
  csrfCookieName: process.env.CSRF_COOKIE_NAME ?? "kainwise_csrf_secret",
  csrfHeaderName: process.env.CSRF_HEADER_NAME ?? "x-csrf-token",
  brevoSmtp: process.env.BREVO_SMTP ?? "",
  brevoSenderEmail: process.env.BREVO_SENDER_EMAIL ?? "",
  brevoSmtpUser:
    process.env.BREVO_SMTP_USER ?? process.env.BREVO_SENDER_EMAIL ?? "",
  brevoApiKey: process.env.BREVO_API_KEY ?? "",
};
