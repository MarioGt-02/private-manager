import OpenAI from "openai";

/**
 * Server-only OpenAI client. Created lazily so importing this module never
 * requires OPENAI_API_KEY or a network connection (important for `next build`).
 * Cached on `globalThis` to avoid recreating the client on hot reloads.
 */
const globalForOpenAI = globalThis as unknown as { openaiClient?: OpenAI };

export function getOpenAIClient(): OpenAI {
  if (!process.env.OPENAI_API_KEY) {
    throw new Error(
      "OPENAI_API_KEY is not set. Configure it in .env before using AI features.",
    );
  }

  if (!globalForOpenAI.openaiClient) {
    globalForOpenAI.openaiClient = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
      ...(process.env.OPENAI_BASE_URL
        ? { baseURL: process.env.OPENAI_BASE_URL }
        : {}),
    });
  }

  return globalForOpenAI.openaiClient;
}
