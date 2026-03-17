import OpenAI from "openai";

export const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

export const VECTOR_STORE_ID = process.env.OPENAI_VECTOR_STORE_ID!;
export const MODEL = "gpt-5.4";
