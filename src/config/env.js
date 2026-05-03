import "dotenv/config";

const toNumber = (value, fallback) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

export const env = {
  nodeEnv: process.env.NODE_ENV ?? "development",
  port: toNumber(process.env.PORT, 3000),
  databaseUrl: process.env.DATABASE_URL ?? "file:./prisma/dev.db",
  geminiApiKey: process.env.GEMINI_API_KEY ?? "",
  geminiLiveModel:
    process.env.GEMINI_LIVE_MODEL ?? "gemini-3.1-flash-live-preview",
  jwtAccessSecret: process.env.JWT_ACCESS_SECRET ?? "",
  jwtRefreshSecret: process.env.JWT_REFRESH_SECRET ?? "",
  jwtResetSecret: process.env.JWT_RESET_SECRET ?? "",
  turnstileSecretKey: process.env.TURNSTILE_SECRET_KEY ?? "",
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
  geminiEmbeddingModel:
    process.env.GEMINI_EMBEDDING_MODEL ?? "gemini-embedding-2",
  rateLimitWindowMs: toNumber(process.env.RATE_LIMIT_WINDOW_MS, 15 * 60 * 1000),
  rateLimitGlobalMax: toNumber(process.env.RATE_LIMIT_GLOBAL_MAX, 200),
  rateLimitWriteMax: toNumber(process.env.RATE_LIMIT_WRITE_MAX, 60),
  rateLimitAiMax: toNumber(process.env.RATE_LIMIT_AI_MAX, 20),
  rateLimitScanMax: toNumber(process.env.RATE_LIMIT_SCAN_MAX, 20),
  rateLimitUploadMax: toNumber(process.env.RATE_LIMIT_UPLOAD_MAX, 10),
  rateLimitTaskMax: toNumber(process.env.RATE_LIMIT_TASK_MAX, 30),
  csrfCookieName: process.env.CSRF_COOKIE_NAME ?? "kainwise_csrf_secret",
  csrfHeaderName: process.env.CSRF_HEADER_NAME ?? "x-csrf-token",
};
