import { prisma } from "../../lib/prisma.js";
import { asyncHandler } from "../../utils/async-handler.js";
import { scoreFood } from "../../services/wellness/wellness.service.js";
import { refreshDailySummary } from "../../services/wellness/daily-summary.service.js";
import { analyzeScan, analyzeMeal } from "../../services/ai/ai.service.js";
import { lookupOpenFoodFactsBarcode } from "../../services/nutrition/food-api.service.js";
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
  res,
}) => {
  if (!uploadResult) {
    return res.status(415).json({ error: "Unsupported file type" });
  }

  const { text, kind, mime } = uploadResult;
  if (!text) {
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

  const productName = text.split("\n").find(Boolean)?.trim() ?? "Food item";
  const analysis = await analyzeMeal({
    profile,
    healthContext: profile.healthContext,
    mealText: text,
  });

  const nutrition = analysis.nutrition ?? {};
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
      barcode: null,
      productName,
      foodType: analysis.foodType ?? inferFoodType({ mealText: text }),
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
        mediaAsset,
      },
    },
  });

  await refreshDailySummary(profileId, scan.createdAt);

  return res.status(201).json({
    scan,
    upload: { kind, mime, text, mediaAsset },
    analysis,
  });
};

export const registerScanRoutes = (app) => {
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
        take: 20,
      });

      res.json({ scans });
    }),
  );
};
