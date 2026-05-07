import { prisma } from "../../lib/prisma.js";
import { asyncHandler } from "../../utils/async-handler.js";
import { scoreFood } from "../../services/wellness/wellness.service.js";
import { refreshDailySummary } from "../../services/wellness/daily-summary.service.js";
import {
  analyzeScan,
  analyzeMeal,
  analyzeManualMeal,
  analyzePhotoMeal,
  correctManualFoodInput,
} from "../../services/ai/ai.service.js";
import {
  lookupOpenFoodFactsBarcode,
  searchOpenFoodFacts,
} from "../../services/nutrition/food-api.service.js";
import { extractTextFromUpload } from "../../services/media/upload-text.service.js";
import { uploadMediaToImageKit } from "../../services/media/imagekit.service.js";
import { buildImageKitFolder } from "../../services/media/imagekit.service.js";
import multer from "multer";
import { env } from "../../config/env.js";
import {
  scanRouteLimiter,
  uploadRouteLimiter,
} from "../../middleware/security.middleware.js";
import { requireProfileAccess } from "../../services/profile/profile-access.service.js";
import { inferFoodType } from "../../services/nutrition/meal-knowledge.service.js";

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

const isAllowedUploadType = (mime) =>
  allowedMimeTypes.has(String(mime ?? "").toLowerCase());

const toNullableNumber = (value) => {
  if (value === undefined || value === null || value === "") {
    return null;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const getScannerInsights = (scan = {}) =>
  scan?.aiAnalysis &&
  typeof scan.aiAnalysis === "object" &&
  !Array.isArray(scan.aiAnalysis)
    ? scan.aiAnalysis.scannerInsights
    : null;

const normalizeScannerInsights = (value = {}) => {
  const patternNotice = value?.patternNotice ?? {};
  const mentalSupport = value?.mentalSupport ?? {};

  return {
    resultId: String(value?.resultId ?? "").trim() || null,
    generatedAt: value?.generatedAt ?? new Date().toISOString(),
    patternNotice: {
      title: String(patternNotice.title ?? "Pattern notice").trim(),
      trendLine: String(patternNotice.trendLine ?? "").trim(),
      hydrationLine: String(patternNotice.hydrationLine ?? "").trim(),
      suggestions: Array.isArray(patternNotice.suggestions)
        ? patternNotice.suggestions.map(String).filter(Boolean).slice(0, 6)
        : [],
      tone: ["green", "amber", "red"].includes(patternNotice.tone)
        ? patternNotice.tone
        : "amber",
    },
    mentalSupport: {
      title: String(mentalSupport.title ?? "Mind & energy impact").trim(),
      summary: String(mentalSupport.summary ?? "").trim(),
      confidence: ["low", "medium", "high"].includes(
        String(mentalSupport.confidence ?? "").toLowerCase(),
      )
        ? String(mentalSupport.confidence).toLowerCase()
        : "medium",
      tone: ["green", "amber", "red"].includes(mentalSupport.tone)
        ? mentalSupport.tone
        : "amber",
      contributors: Array.isArray(mentalSupport.contributors)
        ? mentalSupport.contributors.map(String).filter(Boolean).slice(0, 5)
        : [],
      actions: Array.isArray(mentalSupport.actions)
        ? mentalSupport.actions.map(String).filter(Boolean).slice(0, 5)
        : [],
      motivation: String(mentalSupport.motivation ?? "").trim(),
    },
  };
};

const resolveMealTiming = (payload = {}) => {
  const eatenAt = payload.eatenAt ? new Date(payload.eatenAt) : new Date();
  const safeEatenAt = Number.isNaN(eatenAt.getTime()) ? new Date() : eatenAt;
  const hour = safeEatenAt.getHours();
  const inferred =
    hour < 5
      ? "midnight"
      : hour < 11
        ? "morning"
        : hour < 15
          ? "afternoon"
          : hour < 19
            ? "evening"
            : "night";
  return { eatenAt: safeEatenAt, mealPeriod: inferred };
};

const normalizeBarcodeValue = (value) =>
  String(value ?? "")
    .trim()
    .replace(/\D/g, "");

const extractBarcodeCandidate = (...values) => {
  for (const value of values) {
    const barcode = normalizeBarcodeValue(value);
    if ([8, 12, 13, 14].includes(barcode.length)) {
      return barcode;
    }
  }

  for (const value of values) {
    const chunks = String(value ?? "").match(/\d{8,14}/g) ?? [];
    if (chunks.length > 0) {
      return chunks[0];
    }
  }

  return null;
};

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: env.ocrMaxFileSizeMb * 1024 * 1024,
  },
});

const analyzeUploadedScan = async ({
  profile,
  profileId,
  uploadResult,
  uploadFile,
  uploadPayload = {},
  res,
}) => {
  if (!uploadResult) {
    return res.status(415).json({ error: "Unsupported file type" });
  }

  const { text, kind, mime } = uploadResult;
  const providedBarcode = uploadPayload.barcode?.trim();
  const detectedBarcode =
    kind !== "image" ? extractBarcodeCandidate(text) : null;
  const barcode = providedBarcode || detectedBarcode || null;
  const timing = resolveMealTiming(uploadPayload);

  if (!text && kind !== "image" && !barcode) {
    return res.status(422).json({ error: "Could not read text from file" });
  }

  let mediaAsset = null;
  if (uploadFile?.buffer?.length) {
    try {
      mediaAsset = await uploadMediaToImageKit({
        buffer: uploadFile.buffer,
        originalName: uploadFile.originalname,
        fallbackName: `scan-${profileId}`,
        mimetype: uploadFile.mimetype,
        folder: buildImageKitFolder({
          profile,
          fileType: uploadFile?.mimetype?.startsWith("image/")
            ? "scans-images"
            : "scans-files",
        }),
        tags: ["scan", "upload"],
      });
    } catch (error) {
      console.warn("imagekit.upload.scan.failed", {
        profileId,
        message: error?.message,
      });
    }
  }

  const barcodeData = barcode
    ? await lookupOpenFoodFactsBarcode(barcode)
    : null;
  const productName =
    uploadPayload.productName?.trim() ??
    barcodeData?.productName ??
    text?.split("\n").find(Boolean)?.trim() ??
    (barcode ? `Barcode ${barcode}` : "Food item");
  const analysis =
    barcode || barcodeData
      ? await analyzeScan({
          profile,
          healthContext: profile.healthContext,
          productName,
          nutrition: barcodeData?.nutrition ?? {},
          scoreResult: scoreFood({
            nutrition: barcodeData?.nutrition ?? {},
            productName,
            profile,
            healthStatus: profile.healthContext?.status ?? null,
          }),
        })
      : kind === "image"
        ? await analyzePhotoMeal({
            profile,
            healthContext: profile.healthContext,
            mealText: productName,
            image: uploadFile,
            ocrText: text,
          })
        : await analyzeMeal({
            profile,
            healthContext: profile.healthContext,
            mealText: text,
          });

  const nutrition = analysis.nutrition ?? barcodeData?.nutrition ?? {};
  const scanResult = scoreFood({
    nutrition,
    productName,
    profile,
    healthStatus: profile.healthContext?.status ?? null,
  });

  const scan = await prisma.foodScan.create({
    data: {
      profileId,
      imageUrl: mediaAsset?.url ?? null,
      imageThumbnailUrl: mediaAsset?.thumbnailUrl ?? null,
      imageFileId: mediaAsset?.fileId ?? null,
      imageFilePath: mediaAsset?.filePath ?? null,
      barcode,
      productName,
      foodType:
        analysis.foodType ??
        inferFoodType({ mealText: productName, barcode: barcode ?? undefined }),
      estimatedPricePhp: analysis.budgetEstimatePhp ?? null,
      estimatedPriceCurrency:
        analysis.budgetContext?.currency ??
        profile.budgetCurrency ??
        profile.incomeCurrency ??
        "PHP",
      calories:
        nutrition.calories !== undefined ? Number(nutrition.calories) : null,
      sugarGrams:
        nutrition.sugarGrams !== undefined
          ? Number(nutrition.sugarGrams)
          : null,
      sodiumMg:
        nutrition.sodiumMg !== undefined ? Number(nutrition.sodiumMg) : null,
      fatGrams:
        nutrition.fatGrams !== undefined ? Number(nutrition.fatGrams) : null,
      proteinGrams:
        nutrition.proteinGrams !== undefined
          ? Number(nutrition.proteinGrams)
          : null,
      fiberGrams:
        nutrition.fiberGrams !== undefined
          ? Number(nutrition.fiberGrams)
          : null,
      score: scanResult.score,
      supportLevel: scanResult.supportLevel,
      wellnessImpact: analysis.summary ?? scanResult.wellnessImpact,
      betterAlternatives:
        analysis.alternatives ?? scanResult.betterAlternatives,
      notes: analysis.flags ?? scanResult.notes,
      aiAnalysis: {
        ...analysis,
        scanMethod: kind,
        fileMime: mime,
        extractedText: text,
        barcode,
        barcodeData,
        mediaAsset,
      },
      mealPeriod: timing.mealPeriod,
      eatenAt: timing.eatenAt,
    },
  });

  await refreshDailySummary(profileId, scan.createdAt);

  return res.status(201).json({
    scan,
    upload: { kind, mime, text, barcode, barcodeData, mediaAsset },
    analysis,
  });
};

export const registerScanRoutes = (app) => {
  app.get(
    "/products/search",
    asyncHandler(async (req, res) => {
      const query = String(req.query.q ?? req.query.query ?? "").trim();
      if (query.length < 2) {
        return res.json({ products: [] });
      }

      const product = await searchOpenFoodFacts(query);
      res.json({ products: product ? [product] : [] });
    }),
  );

  app.post(
    "/scans",
    scanRouteLimiter,
    asyncHandler(async (req, res) => {
      const payload = req.body ?? {};

      if (!payload.profileId) {
        return res.status(400).json({ error: "profileId is required" });
      }

      if (!payload.productName?.trim() && !payload.barcode?.trim()) {
        return res
          .status(400)
          .json({ error: "barcode or productName is required" });
      }

      const profile = await prisma.profile.findUnique({
        where: { id: payload.profileId },
        include: { healthContext: true },
      });

      if (!profile) {
        return res.status(404).json({ error: "Profile not found" });
      }

      const barcode = payload.barcode?.trim() ?? null;
      const timing = resolveMealTiming(payload);
      const barcodeData = barcode
        ? await lookupOpenFoodFactsBarcode(barcode)
        : null;
      const nutrition = {
        ...(barcodeData?.nutrition ?? {}),
        ...(payload.nutrition ?? {}),
      };
      const productName =
        payload.productName?.trim() ??
        barcodeData?.productName ??
        barcode ??
        "Food item";
      const result = scoreFood({
        nutrition,
        productName,
        profile,
        healthStatus: profile.healthContext?.status ?? null,
      });
      const aiAnalysis = await analyzeScan({
        profile,
        healthContext: profile.healthContext,
        productName,
        nutrition,
        scoreResult: result,
      });

      const scan = await prisma.foodScan.create({
        data: {
          profileId: payload.profileId,
          barcode,
          productName,
          foodType:
            aiAnalysis.foodType ?? inferFoodType({ mealText: productName }),
          estimatedPricePhp: null,
          estimatedPriceCurrency:
            profile.budgetCurrency ?? profile.incomeCurrency ?? "PHP",
          calories:
            nutrition.calories !== undefined
              ? Number(nutrition.calories)
              : null,
          sugarGrams:
            nutrition.sugarGrams !== undefined
              ? Number(nutrition.sugarGrams)
              : null,
          sodiumMg:
            nutrition.sodiumMg !== undefined
              ? Number(nutrition.sodiumMg)
              : null,
          fatGrams:
            nutrition.fatGrams !== undefined
              ? Number(nutrition.fatGrams)
              : null,
          proteinGrams:
            nutrition.proteinGrams !== undefined
              ? Number(nutrition.proteinGrams)
              : null,
          fiberGrams:
            nutrition.fiberGrams !== undefined
              ? Number(nutrition.fiberGrams)
              : null,
          score: result.score,
          supportLevel: result.supportLevel,
          wellnessImpact: result.wellnessImpact,
          betterAlternatives:
            aiAnalysis.alternatives ?? result.betterAlternatives,
          notes: aiAnalysis.flags ?? result.notes,
          aiAnalysis,
          mealPeriod: timing.mealPeriod,
          eatenAt: timing.eatenAt,
        },
      });

      await refreshDailySummary(payload.profileId, scan.createdAt);

      res.status(201).json({
        scan,
        barcodeData,
        interpretation: {
          score: result.score,
          supportLevel: result.supportLevel,
          wellnessImpact: aiAnalysis.summary ?? result.wellnessImpact,
          betterAlternatives:
            aiAnalysis.alternatives ?? result.betterAlternatives,
          notes: aiAnalysis.flags ?? result.notes,
          aiAnalysis,
          suggestedSwap: aiAnalysis.suggestion ?? result.betterAlternatives[0],
        },
      });
    }),
  );

  app.post(
    "/scans/live-result",
    scanRouteLimiter,
    asyncHandler(async (req, res) => {
      const payload = req.body ?? {};

      if (!payload.profileId) {
        return res.status(400).json({ error: "profileId is required" });
      }

      if (!payload.productName?.trim()) {
        return res.status(400).json({ error: "productName is required" });
      }

      const profile = await prisma.profile.findUnique({
        where: { id: payload.profileId },
        include: { healthContext: true },
      });

      if (!profile) {
        return res.status(404).json({ error: "Profile not found" });
      }

      const access = await requireProfileAccess(req, res, profile);
      if (!access.allowed) {
        return;
      }

      const analysis = payload.analysis ?? {};
      if (analysis.isFood === false) {
        return res.status(422).json({
          error:
            analysis.rejectionReason ??
            "Input does not look like food or a drink",
        });
      }

      const nutrition = payload.nutrition ?? analysis.nutrition ?? {};
      const productName = payload.productName.trim();
      const timing = resolveMealTiming(payload);
      const result = scoreFood({
        nutrition,
        productName,
        profile,
        healthStatus: profile.healthContext?.status ?? null,
      });

      const scan = await prisma.foodScan.create({
        data: {
          profileId: payload.profileId,
          barcode: payload.barcode?.trim() || null,
          productName,
          foodType:
            analysis.foodType ?? inferFoodType({ mealText: productName }),
          estimatedPricePhp: toNullableNumber(
            analysis.estimatedPricePhp ?? analysis.budgetEstimatePhp,
          ),
          estimatedPriceCurrency:
            profile.budgetCurrency ?? profile.incomeCurrency ?? "PHP",
          calories: toNullableNumber(nutrition.calories),
          sugarGrams: toNullableNumber(nutrition.sugarGrams),
          sodiumMg: toNullableNumber(nutrition.sodiumMg),
          fatGrams: toNullableNumber(nutrition.fatGrams),
          proteinGrams: toNullableNumber(nutrition.proteinGrams),
          fiberGrams: toNullableNumber(nutrition.fiberGrams),
          score: Number.isFinite(Number(analysis.score))
            ? Number(analysis.score)
            : result.score,
          supportLevel: analysis.supportLevel ?? result.supportLevel,
          wellnessImpact:
            analysis.summary ??
            analysis.wellnessImpact ??
            result.wellnessImpact,
          betterAlternatives:
            analysis.alternatives ?? result.betterAlternatives,
          notes: analysis.flags ?? result.notes,
          aiAnalysis: {
            source: "gemini-live-browser",
            ...analysis,
          },
          mealPeriod: timing.mealPeriod,
          eatenAt: timing.eatenAt,
        },
      });

      setImmediate(() => {
        refreshDailySummary(payload.profileId, scan.createdAt).catch((error) =>
          console.error("scan.live.summary.error", {
            profileId: payload.profileId,
            scanId: scan.id,
            message: error?.message ?? "Unknown summary error",
          }),
        );
      });

      res.status(201).json({ scan, analysis });
    }),
  );

  app.post(
    "/scans/manual",
    scanRouteLimiter,
    asyncHandler(async (req, res) => {
      const payload = req.body ?? {};
      const input = String(
        payload.foodText ?? payload.mealText ?? payload.productName ?? "",
      ).trim();

      if (!payload.profileId) {
        return res.status(400).json({ error: "profileId is required" });
      }

      if (!input) {
        return res.status(400).json({ error: "foodText is required" });
      }

      const profile = await prisma.profile.findUnique({
        where: { id: payload.profileId },
        include: { healthContext: true },
      });

      if (!profile) {
        return res.status(404).json({ error: "Profile not found" });
      }

      const access = await requireProfileAccess(req, res, profile);
      if (!access.allowed) {
        return;
      }

      const correction = await correctManualFoodInput({
        profile,
        healthContext: profile.healthContext,
        input,
      });
      const correctedQuery = correction.correctedQuery || input;
      const analysis = await analyzeManualMeal({
        profile,
        healthContext: profile.healthContext,
        mealText: correctedQuery,
        lookupPackagedFood: true,
      });
      const nutrition = analysis.nutrition ?? {};
      const productName =
        analysis.mealName ?? correction.displayName ?? correctedQuery;
      const result = scoreFood({
        nutrition,
        productName,
        profile,
        healthStatus: profile.healthContext?.status ?? null,
      });
      const timing = resolveMealTiming(payload);

      const scan = await prisma.foodScan.create({
        data: {
          profileId: payload.profileId,
          barcode: null,
          productName,
          foodType:
            analysis.foodType ?? inferFoodType({ mealText: productName }),
          estimatedPricePhp: toNullableNumber(analysis.budgetEstimatePhp),
          estimatedPriceCurrency:
            analysis.budgetContext?.currency ??
            profile.budgetCurrency ??
            profile.incomeCurrency ??
            "PHP",
          calories: toNullableNumber(nutrition.calories),
          sugarGrams: toNullableNumber(nutrition.sugarGrams),
          sodiumMg: toNullableNumber(nutrition.sodiumMg),
          fatGrams: toNullableNumber(nutrition.fatGrams),
          proteinGrams: toNullableNumber(nutrition.proteinGrams),
          fiberGrams: toNullableNumber(nutrition.fiberGrams),
          score: result.score,
          supportLevel: analysis.supportLevel ?? result.supportLevel,
          wellnessImpact:
            analysis.summary ??
            analysis.wellnessImpact ??
            result.wellnessImpact,
          betterAlternatives:
            analysis.alternatives ?? result.betterAlternatives,
          notes: analysis.flags ?? analysis.warnings ?? result.notes,
          aiAnalysis: {
            source: "manual-server-gemini",
            originalInput: input,
            correctedInput: correctedQuery,
            correction,
            ...analysis,
          },
          mealPeriod: timing.mealPeriod,
          eatenAt: timing.eatenAt,
        },
      });

      setImmediate(() => {
        refreshDailySummary(payload.profileId, scan.createdAt).catch((error) =>
          console.error("scan.manual.summary.error", {
            profileId: payload.profileId,
            scanId: scan.id,
            message: error?.message ?? "Unknown summary error",
          }),
        );
      });

      res.status(201).json({ scan, analysis, correction });
    }),
  );

  app.post(
    "/scans/image",
    uploadRouteLimiter,
    upload.single("image"),
    asyncHandler(async (req, res) => {
      const payload = req.body ?? {};

      if (!payload.profileId) {
        return res.status(400).json({ error: "profileId is required" });
      }

      if (!req.file?.buffer?.length) {
        return res.status(400).json({ error: "image is required" });
      }

      if (!isAllowedUploadType(req.file.mimetype)) {
        return res.status(415).json({ error: "Unsupported file type" });
      }

      const profile = await prisma.profile.findUnique({
        where: { id: payload.profileId },
        include: { healthContext: true },
      });

      if (!profile) {
        return res.status(404).json({ error: "Profile not found" });
      }

      const uploadResult = await extractTextFromUpload({
        buffer: req.file.buffer,
        mimetype: req.file.mimetype,
      });

      const result = await analyzeUploadedScan({
        profile,
        profileId: payload.profileId,
        uploadResult,
        uploadFile: req.file,
        uploadPayload: payload,
        res,
      });

      return result;
    }),
  );

  app.post(
    "/scans/upload",
    uploadRouteLimiter,
    upload.single("file"),
    asyncHandler(async (req, res) => {
      const payload = req.body ?? {};

      if (!payload.profileId) {
        return res.status(400).json({ error: "profileId is required" });
      }

      if (!req.file?.buffer?.length) {
        return res.status(400).json({ error: "file is required" });
      }

      if (!isAllowedUploadType(req.file.mimetype)) {
        return res.status(415).json({ error: "Unsupported file type" });
      }

      const profile = await prisma.profile.findUnique({
        where: { id: payload.profileId },
        include: { healthContext: true },
      });

      if (!profile) {
        return res.status(404).json({ error: "Profile not found" });
      }

      const uploadResult = await extractTextFromUpload({
        buffer: req.file.buffer,
        mimetype: req.file.mimetype,
      });

      return analyzeUploadedScan({
        profile,
        profileId: payload.profileId,
        uploadResult,
        uploadFile: req.file,
        uploadPayload: payload,
        res,
      });
    }),
  );

  app.get(
    "/scans/:profileId",
    asyncHandler(async (req, res) => {
      const profile = await prisma.profile.findUnique({
        where: { id: req.params.profileId },
        select: { id: true, role: true, parentProfileId: true },
      });

      if (!profile) {
        return res.status(404).json({ error: "Profile not found" });
      }

      const access = await requireProfileAccess(req, res, profile);
      if (!access.allowed) {
        return;
      }

      const scans = await prisma.foodScan.findMany({
        where: { profileId: req.params.profileId },
        orderBy: { createdAt: "desc" },
        take: 200,
      });

      res.json({ scans });
    }),
  );

  app.get(
    "/scans/:scanId/insights",
    asyncHandler(async (req, res) => {
      const scan = await prisma.foodScan.findUnique({
        where: { id: req.params.scanId },
        include: {
          profile: {
            select: { id: true, role: true, parentProfileId: true },
          },
        },
      });

      if (!scan) {
        return res.status(404).json({ error: "Scan not found" });
      }

      const access = await requireProfileAccess(req, res, scan.profile);
      if (!access.allowed) {
        return;
      }

      res.json({
        insights: getScannerInsights(scan),
      });
    }),
  );

  app.put(
    "/scans/:scanId/insights",
    scanRouteLimiter,
    asyncHandler(async (req, res) => {
      const scan = await prisma.foodScan.findUnique({
        where: { id: req.params.scanId },
        include: {
          profile: {
            select: { id: true, role: true, parentProfileId: true },
          },
        },
      });

      if (!scan) {
        return res.status(404).json({ error: "Scan not found" });
      }

      const access = await requireProfileAccess(req, res, scan.profile);
      if (!access.allowed) {
        return;
      }

      const insights = normalizeScannerInsights({
        ...(req.body?.insights ?? req.body ?? {}),
        resultId: scan.id,
        generatedAt: new Date().toISOString(),
      });
      const aiAnalysis =
        scan.aiAnalysis &&
        typeof scan.aiAnalysis === "object" &&
        !Array.isArray(scan.aiAnalysis)
          ? scan.aiAnalysis
          : {};
      const updated = await prisma.foodScan.update({
        where: { id: scan.id },
        data: {
          aiAnalysis: {
            ...aiAnalysis,
            scannerInsights: insights,
          },
        },
      });

      res.json({
        scan: updated,
        insights,
      });
    }),
  );

  app.post(
    "/scans/:scanId/image",
    uploadRouteLimiter,
    upload.single("image"),
    asyncHandler(async (req, res) => {
      if (!req.file?.buffer?.length) {
        return res.status(400).json({ error: "image is required" });
      }

      if (!isAllowedUploadType(req.file.mimetype)) {
        return res.status(415).json({ error: "Unsupported file type" });
      }

      const scan = await prisma.foodScan.findUnique({
        where: { id: req.params.scanId },
        include: {
          profile: true,
        },
      });

      if (!scan) {
        return res.status(404).json({ error: "Scan not found" });
      }

      const access = await requireProfileAccess(req, res, scan.profile);
      if (!access.allowed) {
        return;
      }

      let mediaAsset = null;
      try {
        mediaAsset = await uploadMediaToImageKit({
          buffer: req.file.buffer,
          originalName: req.file.originalname,
          fallbackName: `scan-${scan.profileId}`,
          mimetype: req.file.mimetype,
          folder: buildImageKitFolder({
            profile: scan.profile,
            fileType: "scans-images",
          }),
          tags: ["scan", "upload"],
        });
      } catch (error) {
        console.warn("imagekit.upload.scan.attach.failed", {
          scanId: scan.id,
          message: error?.message,
        });
        return res.status(502).json({ error: "Image upload failed" });
      }

      if (!mediaAsset) {
        return res.status(502).json({ error: "Image upload failed" });
      }

      const updated = await prisma.foodScan.update({
        where: { id: scan.id },
        data: {
          imageUrl: mediaAsset.url,
          imageThumbnailUrl: mediaAsset.thumbnailUrl,
          imageFileId: mediaAsset.fileId,
          imageFilePath: mediaAsset.filePath,
        },
      });

      res.json({ scan: updated, mediaAsset });
    }),
  );

  app.delete(
    "/scans/:scanId",
    asyncHandler(async (req, res) => {
      const scan = await prisma.foodScan.findUnique({
        where: { id: req.params.scanId },
        include: {
          profile: {
            select: { id: true, role: true, parentProfileId: true },
          },
        },
      });

      if (!scan) {
        return res.status(404).json({ error: "Scan not found" });
      }

      const access = await requireProfileAccess(req, res, scan.profile);
      if (!access.allowed) {
        return;
      }

      await prisma.foodScan.delete({ where: { id: scan.id } });
      await refreshDailySummary(scan.profileId, scan.createdAt, {
        skipAi: true,
      }).catch(() => {});

      res.json({ ok: true });
    }),
  );
};
