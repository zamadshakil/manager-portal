import { z } from "zod";

export const leadSchema = z.object({
  name: z.string().trim().min(2).max(100),
  email: z
    .string()
    .trim()
    .email()
    .max(254)
    .transform((v) => v.toLowerCase()),
  company: z.string().trim().min(2).max(150),
  segment: z.enum(["agencies", "ecommerce", "training", "other"]),
  teamSize: z.coerce.number().int().min(1).max(100000),
  weeklySubmissions: z.coerce.number().int().min(1).max(100000),
  workflow: z.string().trim().min(10).max(1200),
  preferredTime: z.string().trim().max(200).default(""),
  marketingConsent: z.boolean().default(false),
  privacyAccepted: z.literal(true),
  website: z.string().max(200).default(""),
  source: z.string().trim().max(100).default("website"),
  medium: z.string().trim().max(100).default("direct"),
  campaign: z.string().trim().max(100).default("showcase"),
});
export type FunnelLead = z.infer<typeof leadSchema>;

export function scoreLead(
  lead: Pick<FunnelLead, "segment" | "teamSize" | "weeklySubmissions">,
) {
  return (
    (lead.segment === "agencies" ? 35 : lead.segment !== "other" ? 25 : 5) +
    (lead.teamSize >= 15 && lead.teamSize <= 150
      ? 30
      : lead.teamSize >= 10
        ? 15
        : 0) +
    (lead.weeklySubmissions >= 50 ? 35 : lead.weeklySubmissions >= 20 ? 20 : 5)
  );
}

export function reviewEstimate(
  volume: number,
  minutes: number,
  reworkPercent: number,
  improvementPercent: number,
) {
  const baseHours = (volume * minutes) / 60;
  const reworkHours = (baseHours * reworkPercent) / 100;
  const totalHours = baseHours + reworkHours;
  return {
    baseHours,
    reworkHours,
    totalHours,
    potentialHours: (totalHours * improvementPercent) / 100,
  };
}
