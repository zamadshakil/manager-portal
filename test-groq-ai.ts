import { generateObject } from "ai";
import { google } from "@ai-sdk/google";
import { z } from "zod";

const models = ["gemini-3.1-flash-lite-preview", "gemini-2.5-flash-lite"];

async function test() {
  for (const model of models) {
    try {
      const { object } = await generateObject({
        model: google(model),
        temperature: 0,
        schema: z.object({
          pass: z.boolean(),
          score: z.number().min(0).max(100),
          reasons: z.array(z.string()).max(8),
        }),
        prompt: "Rate this document: Good work with proper grammar. Threshold: 80.",
      });
      console.log(`✅ ${model}:`, JSON.stringify(object));
    } catch (err: any) {
      const msg = err?.message?.split("\n")[0] || err;
      console.log(`❌ ${model}: ${msg}`);
    }
  }
}

test();
