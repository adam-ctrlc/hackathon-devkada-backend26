import { prisma } from "../../lib/prisma.js";
import { asyncHandler } from "../../utils/async-handler.js";
import {
  analyzeManualMeal,
  analyzePhotoMeal,
} from "../../services/ai/ai.service.js";
import { refreshDailySummary } from "../../services/wellness/daily-summary.service.js";
import { aiRouteLimiter } from "../../middleware/security.middleware.js";
import multer from "multer";
import { env } from "../../config/env.js";
import { extractTextFromUpload } from "../../services/media/upload-text.service.js";
import {
  buildImageKitFolder,
  uploadMediaToImageKit,
} from "../../services/media/imagekit.service.js";
import { uploadRouteLimiter } from "../../middleware/security.middleware.js";
import { requireProfileAccess } from "../../services/profile/profile-access.service.js";

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

export const registerMealsRoutes = (app) => {
  app.post(
    "/meals",
    aiRouteLimiter,
    asyncHandler(async (req, res) => {
      const payload = req.body ?? {};
      const mealText = String(payload.mealText ?? "").trim();

      if (!payload.profileId) {
        return res.status(400).json({ error: "profileId is required" });
      }

      if (!mealText) {
        return res.status(400).json({ error: "mealText is required" });
      }

      const profile = await prisma.profile.findUnique({
        where: { id: payload.profileId },
        include: { healthContext: true },
      });

      if (!profile) {
        return res.status(404).json({ error: "Profile not found" });
      }

      const analysis = await analyzeManualMeal({
        profile,
        healthContext: profile.healthContext,
        mealText,
        lookupPackagedFood: false,
        budgetMode: Boolean(payload.budgetMode),
      });

      const mealLog = await prisma.mealLog.create({
        data: {
          profileId: payload.profileId,
          rawText: mealText,
          matchedProductName: analysis.mealName ?? null,
          foodType: analysis.foodType ?? null,
          source: "manual",
          estimatedPricePhp: analysis.budgetEstimatePhp ?? null,
          estimatedPriceCurrency:
            analysis.budgetContext?.currency ??
            profile.budgetCurrency ??
            profile.incomeCurrency ??
            "PHP",
          calories: analysis.nutrition?.calories ?? null,
          sugarGrams: analysis.nutrition?.sugarGrams ?? null,
          sodiumMg: analysis.nutrition?.sodiumMg ?? null,
          fatGrams: analysis.nutrition?.fatGrams ?? null,
          proteinGrams: analysis.nutrition?.proteinGrams ?? null,
          fiberGrams: analysis.nutrition?.fiberGrams ?? null,
          score: analysis.scoreResult?.score ?? 0,
          supportLevel: analysis.scoreResult?.supportLevel ?? "Low",
          wellnessImpact:
            analysis.scoreResult?.wellnessImpact ??
            analysis.summary ??
            "Meal analyzed",
          betterAlternatives: analysis.alternatives ?? [],
          notes: analysis.warnings ?? analysis.flags ?? [],
          aiAnalysis: analysis,
        },
      });

      await refreshDailySummary(payload.profileId, mealLog.createdAt);

      res.status(201).json({
        mealLog,
        analysis,
        foodApi: analysis.source?.includes("gemini")
          ? "gemini-or-local"
          : "local",
        budgetContext: analysis.budgetContext,
      });
    }),
  );

  app.post(
    "/meals/photo",
    uploadRouteLimiter,
    upload.single("photo"),
    asyncHandler(async (req, res) => {
      const payload = req.body ?? {};

      if (!payload.profileId) {
        return res.status(400).json({ error: "profileId is required" });
      }

      if (!req.file?.buffer?.length) {
        return res.status(400).json({ error: "photo is required" });
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

      const analysis = await analyzePhotoMeal({
        profile,
        healthContext: profile.healthContext,
        mealText: payload.caption?.trim() ?? null,
        ocrText: uploadResult?.text ?? "",
        image: req.file,
        budgetMode: Boolean(payload.budgetMode),
      });
      let mediaAsset = null;
      try {
        mediaAsset = await uploadMediaToImageKit({
          buffer: req.file.buffer,
          originalName: req.file.originalname,
          fallbackName: `meal-${payload.profileId}`,
          mimetype: req.file.mimetype,
          folder: buildImageKitFolder({
            profile,
            fileType: "meals-photos",
          }),
          tags: ["meal", "photo"],
        });
      } catch (error) {
        console.warn("imagekit.upload.meal.failed", {
          profileId: payload.profileId,
          message: error?.message,
        });
      }

      const mealLog = await prisma.mealLog.create({
        data: {
          profileId: payload.profileId,
          imageUrl: mediaAsset?.url ?? null,
          imageThumbnailUrl: mediaAsset?.thumbnailUrl ?? null,
          imageFileId: mediaAsset?.fileId ?? null,
          imageFilePath: mediaAsset?.filePath ?? null,
          rawText:
            payload.caption?.trim() ?? uploadResult?.text ?? "Food photo",
          matchedProductName: analysis.mealName ?? null,
          foodType: analysis.foodType ?? null,
          source: "photo",
          estimatedPricePhp: analysis.budgetEstimatePhp ?? null,
          estimatedPriceCurrency:
            analysis.budgetContext?.currency ??
            profile.budgetCurrency ??
            profile.incomeCurrency ??
            "PHP",
          calories: analysis.nutrition?.calories ?? null,
          sugarGrams: analysis.nutrition?.sugarGrams ?? null,
          sodiumMg: analysis.nutrition?.sodiumMg ?? null,
          fatGrams: analysis.nutrition?.fatGrams ?? null,
          proteinGrams: analysis.nutrition?.proteinGrams ?? null,
          fiberGrams: analysis.nutrition?.fiberGrams ?? null,
          score: analysis.scoreResult?.score ?? 0,
          supportLevel: analysis.scoreResult?.supportLevel ?? "Low",
          wellnessImpact:
            analysis.scoreResult?.wellnessImpact ??
            analysis.summary ??
            "Meal analyzed",
          betterAlternatives: analysis.alternatives ?? [],
          notes: analysis.warnings ?? analysis.flags ?? [],
          aiAnalysis: analysis,
        },
      });

      await refreshDailySummary(payload.profileId, mealLog.createdAt);

      res.status(201).json({
        mealLog,
        analysis,
        budgetContext: analysis.budgetContext,
        upload: {
          kind: uploadResult?.kind ?? "image",
          mime: uploadResult?.mime ?? req.file.mimetype,
          text: uploadResult?.text ?? "",
          mediaAsset,
        },
      });
    }),
  );

  app.get(
    "/meals/:profileId",
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

      const mealLogs = await prisma.mealLog.findMany({
        where: { profileId: req.params.profileId },
        orderBy: { createdAt: "desc" },
        take: 20,
      });

      res.json({ mealLogs });
    }),
  );
};
