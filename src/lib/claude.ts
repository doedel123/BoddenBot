import Anthropic from "@anthropic-ai/sdk";

export const claude = new Anthropic({
  apiKey: process.env.CLAUDE_API_KEY,
});

export const CLAUDE_MODEL = "claude-opus-4-6";
