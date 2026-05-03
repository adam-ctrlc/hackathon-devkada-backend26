import { createWorker } from "tesseract.js";
import { env } from "../../config/env.js";

export const extractTextFromImage = async (imageBuffer) => {
  if (!imageBuffer?.length) {
    return "";
  }

  const worker = await createWorker(env.ocrLanguage);

  try {
    const { data } = await worker.recognize(imageBuffer);
    return String(data?.text ?? "").trim();
  } finally {
    await worker.terminate();
  }
};
