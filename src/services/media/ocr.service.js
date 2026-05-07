import { env } from "../../config/env.js";

const runLocalTesseract = async (imageBuffer) => {
  const tesseractModule = await import("tesseract.js");
  const tesseract = tesseractModule.default;
  const { PSM } = tesseractModule;
  const result = await tesseract.recognize(imageBuffer, "eng", {
    tessedit_pageseg_mode: PSM.SPARSE_TEXT,
    tessedit_char_whitelist: "0123456789",
    preserve_interword_spaces: "1",
    classify_bln_numeric_mode: "1",
  });

  return String(result?.data?.text ?? "").trim();
};

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

  if (response.ok) {
    const data = await response.json();
    const parsedText =
      data?.ParsedResults?.map((item) => item?.ParsedText ?? "").join("\n") ??
      "";

    const text = String(parsedText ?? "").trim();
    if (text) {
      return text;
    }
  }

  return runLocalTesseract(imageBuffer);
};
