import { fileTypeFromBuffer } from "file-type";
import { PDFParse } from "pdf-parse";
import { extractRawText } from "mammoth";
import { extractTextFromImage } from "./ocr.service.js";
import {
  inspectUploadBuffer,
  scanUploadTextForThreats,
} from "./upload-security.service.js";

const normalizeMime = (value) =>
  String(value ?? "")
    .trim()
    .toLowerCase();

export const extractTextFromUpload = async ({ buffer, mimetype }) => {
  if (!buffer?.length) {
    return null;
  }

  const inspection = await inspectUploadBuffer({ buffer, mimetype });
  if (!inspection.allowed) {
    return null;
  }

  const detected = await fileTypeFromBuffer(buffer);
  const mime = normalizeMime(
    detected?.mime ?? inspection.effectiveMime ?? mimetype,
  );

  switch (true) {
    case mime.startsWith("image/"): {
      const text = await extractTextFromImage(buffer);
      const threatCheck = scanUploadTextForThreats(text);
      return threatCheck.allowed ? { kind: "image", mime, text } : null;
    }
    case mime === "application/pdf": {
      const parser = new PDFParse({ data: buffer });
      const result = await parser.getText();
      const text = String(result?.text ?? "").trim();
      const threatCheck = scanUploadTextForThreats(text);
      return text && threatCheck.allowed ? { kind: "pdf", mime, text } : null;
    }
    case mime ===
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document": {
      const result = await extractRawText({ buffer });
      const text = String(result?.value ?? "").trim();
      const threatCheck = scanUploadTextForThreats(text);
      return text && threatCheck.allowed ? { kind: "docx", mime, text } : null;
    }
    case mime === "text/plain": {
      const text = buffer.toString("utf8").trim();
      const threatCheck = scanUploadTextForThreats(text);
      return text && threatCheck.allowed ? { kind: "text", mime, text } : null;
    }
    default:
      return null;
  }
};
