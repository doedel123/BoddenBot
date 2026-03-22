import Anthropic from "@anthropic-ai/sdk";

export const claude = new Anthropic({
  apiKey: process.env.CLAUDE_API_KEY,
});

export const CLAUDE_MODEL_PRIMARY = "claude-opus-4-6";
export const CLAUDE_MODEL_FALLBACK = "claude-sonnet-4-6";

// Exported model used in route – starts as primary, can be swapped
export let CLAUDE_MODEL = CLAUDE_MODEL_PRIMARY;

/** Call with automatic fallback to Sonnet if Opus is overloaded (529). */
export async function claudeCreate(
  params: Omit<Parameters<typeof claude.messages.create>[0], "model">
): Promise<ReturnType<typeof claude.messages.create> extends Promise<infer T> ? T : never> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return await claude.messages.create({ ...params as any, model: CLAUDE_MODEL_PRIMARY }) as any;
  } catch (err: unknown) {
    const status = (err as { status?: number }).status;
    if (status === 529) {
      console.warn("[Claude] Opus 4.6 overloaded (529), falling back to Sonnet 4.6");
      CLAUDE_MODEL = CLAUDE_MODEL_FALLBACK;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return await claude.messages.create({ ...params as any, model: CLAUDE_MODEL_FALLBACK }) as any;
    }
    throw err;
  }
}

/** Stream with automatic fallback to Sonnet if Opus is overloaded (529). */
export function claudeStream(
  params: Omit<Parameters<typeof claude.messages.stream>[0], "model">
) {
  // We can't easily retry a stream after it starts; pre-check with the model variable
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return claude.messages.stream({ ...params as any, model: CLAUDE_MODEL });
}
