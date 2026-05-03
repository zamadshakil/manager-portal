import { serve } from "inngest/next";
import { inngest } from "@/lib/inngest/client";
import { processSubmissionFn, onFailureSubmissionFn, markMissedCronFn } from "@/lib/inngest/functions";

export const maxDuration = 60; // 60s limit for Vercel Hobby, use 300 for Pro
export const dynamic = "force-dynamic";

// Create an API that serves zero-downtime background jobs
export const { GET, POST, PUT } = serve({
  client: inngest,
  functions: [
    processSubmissionFn,
    onFailureSubmissionFn,
    markMissedCronFn,
  ],
});
