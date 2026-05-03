import { prisma } from "../../lib/prisma.js";
import { env } from "../../config/env.js";

const normalizeText = (value) => String(value ?? "").trim();

const splitJournalText = (text, maxChars = 700) => {
  const source = normalizeText(text);
  if (!source) {
    return [];
  }

  const parts = source
    .split(/\n{2,}/g)
    .map((part) => part.trim())
    .filter(Boolean);
  const chunks = [];
  let current = "";

  for (const part of parts.length ? parts : [source]) {
    if ((current + "\n\n" + part).trim().length <= maxChars) {
      current = current ? `${current}\n\n${part}` : part;
      continue;
    }

    if (current) {
      chunks.push(current);
      current = "";
    }

    if (part.length <= maxChars) {
      current = part;
      continue;
    }

    const sentences = part.split(/(?<=[.!?])\s+/g);
    let sentenceChunk = "";
    for (const sentence of sentences) {
      if ((sentenceChunk + " " + sentence).trim().length <= maxChars) {
        sentenceChunk = sentenceChunk
          ? `${sentenceChunk} ${sentence}`
          : sentence;
      } else {
        if (sentenceChunk) {
          chunks.push(sentenceChunk);
        }
        sentenceChunk = sentence;
      }
    }
    if (sentenceChunk) {
      current = sentenceChunk;
    }
  }

  if (current) {
    chunks.push(current);
  }

  return chunks;
};

const cosineSimilarity = (a = [], b = []) => {
  if (!a.length || !b.length || a.length !== b.length) {
    return 0;
  }

  let dot = 0;
  let magA = 0;
  let magB = 0;

  for (let index = 0; index < a.length; index += 1) {
    dot += a[index] * b[index];
    magA += a[index] * a[index];
    magB += b[index] * b[index];
  }

  const denominator = Math.sqrt(magA) * Math.sqrt(magB);
  return denominator ? dot / denominator : 0;
};

const embeddingInput = (text, kind = "query") => {
  const value = normalizeText(text);
  switch (kind) {
    case "document":
      return `task: question answering | title: diary chunk | text: ${value}`;
    default:
      return `task: search result | query: ${value}`;
  }
};

const embedText = async (text, kind = "query") => {
  if (!env.geminiApiKey) {
    return null;
  }

  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(env.geminiEmbeddingModel)}:embedContent?key=${encodeURIComponent(env.geminiApiKey)}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        content: {
          parts: [{ text: embeddingInput(text, kind) }],
        },
      }),
    },
  );

  if (!response.ok) {
    throw new Error(
      `Gemini embedding request failed with HTTP ${response.status}`,
    );
  }

  const data = await response.json();
  const vector =
    data?.embedding?.values ??
    data?.embeddings?.[0]?.values ??
    data?.embeddings?.[0]?.values ??
    null;
  return Array.isArray(vector) ? vector : null;
};

export const indexDiaryEntryChunks = async ({
  profileId,
  diaryEntryId,
  entry,
}) => {
  const chunks = splitJournalText(entry);
  if (!chunks.length) {
    return [];
  }

  const embeddings = await Promise.all(
    chunks.map(async (chunk) => {
      try {
        return await embedText(chunk, "document");
      } catch {
        return null;
      }
    }),
  );

  await prisma.diaryChunk.createMany({
    data: chunks.map((chunkText, index) => ({
      profileId,
      diaryEntryId,
      chunkIndex: index,
      chunkText,
      embedding: embeddings[index] ?? null,
      source: "journal",
    })),
  });

  return chunks.map((chunkText, index) => ({
    chunkText,
    embedding: embeddings[index] ?? null,
  }));
};

export const buildJournalRagContext = async ({
  profileId,
  queryText,
  currentText,
  limit = 5,
}) => {
  const currentChunks = splitJournalText(currentText ?? queryText);
  const query = normalizeText(queryText ?? currentText);
  const queryEmbedding = await embedText(query, "query").catch(() => null);

  const storedChunks = await prisma.diaryChunk.findMany({
    where: { profileId },
    orderBy: { createdAt: "desc" },
    take: 120,
  });

  const candidates = [
    ...currentChunks.map((chunkText, index) => ({
      source: "current",
      chunkIndex: index,
      chunkText,
      embedding: null,
    })),
    ...storedChunks,
  ];

  if (!queryEmbedding) {
    return {
      query,
      currentChunks,
      retrievedChunks: candidates.slice(0, limit).map((item) => ({
        source: item.source ?? "journal",
        chunkText: item.chunkText,
        similarity: null,
      })),
      contextText: candidates
        .slice(0, limit)
        .map((item) => item.chunkText)
        .join("\n\n"),
    };
  }

  const ranked = candidates
    .map((item) => ({
      source: item.source ?? "journal",
      chunkText: item.chunkText,
      similarity: item.embedding
        ? cosineSimilarity(queryEmbedding, item.embedding)
        : 0,
    }))
    .sort((a, b) => b.similarity - a.similarity)
    .slice(0, limit);

  return {
    query,
    currentChunks,
    retrievedChunks: ranked,
    contextText: ranked.map((item) => item.chunkText).join("\n\n"),
  };
};
