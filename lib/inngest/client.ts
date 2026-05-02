import { Inngest } from "inngest";

// Force local routing in development even if production keys are accidentally set
// in .env.local or cached in memory. This prevents jobs from getting stuck in the cloud queue.
if (process.env.NODE_ENV === "development") {
  process.env.INNGEST_EVENT_KEY = "local";
  process.env.INNGEST_SIGNING_KEY = "local";
}

// Create a client to send and receive events
export const inngest = new Inngest({ id: "ai-manager-portal" });
