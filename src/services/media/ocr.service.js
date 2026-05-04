import { env } from "../../config/env.js";

export const extractTextFromImage = async (imageBuffer) => {
  if (!imageBuffer?.length) {
    return "";
  }

  if (!env.ocrSpaceApiKey) {
    return "";
  }

  const form = new FormData();
  form.append("apikey", env.ocrSpaceApiKey);
  form.append("language", env.ocrLanguage);
  form.append("isOverlayRequired", "false");
  form.append("scale", "true");
  form.append("OCREngine", "2");
  form.append("file", new Blob([imageBuffer]), "upload-image");

  const response = await fetch(env.ocrSpaceEndpoint, {
    method: "POST",
    body: form,
  });

  if (!response.ok) {
    throw new Error(`OCR.space request failed with HTTP ${response.status}`);
  }

  const data = await response.json();
  const parsedText = data?.ParsedResults?.map((item) => item?.ParsedText ?? "").join("\n") ?? "";

  return String(parsedText ?? "").trim();
};
