import { leadSchema, scoreLead } from "./funnel";

const reply = (body: object, status = 200) =>
  Response.json(body, { status, headers: { "Cache-Control": "no-store" } });

export async function handleLeadRequest(
  request: Request,
  env: Record<string, string | undefined>,
) {
  const trusted = new Set(
    [
      env.NEXT_PUBLIC_SITE_URL,
      env.FUNNEL_ALTERNATE_ORIGIN,
      env.VERCEL_URL ? `https://${env.VERCEL_URL}` : undefined,
      env.VERCEL_PROJECT_PRODUCTION_URL
        ? `https://${env.VERCEL_PROJECT_PRODUCTION_URL}`
        : undefined,
    ].filter(Boolean),
  );
  if (env.NODE_ENV !== "production") trusted.add("http://localhost:3000");
  if (!trusted.has(request.headers.get("origin") || ""))
    return reply({ error: "Please submit from the showcase website." }, 403);
  if (!request.headers.get("content-type")?.startsWith("application/json"))
    return reply({ error: "Unsupported request format." }, 415);
  // Enforce the byte cap while streaming; Content-Length is not trustworthy.
  const reader = request.body?.getReader();
  if (!reader) return reply({ error: "Please complete the form." }, 400);
  let raw = "",
    size = 0;
  const decoder = new TextDecoder();
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 8192) {
        await reader.cancel();
        return reply({ error: "Request is too large." }, 413);
      }
      raw += decoder.decode(value, { stream: true });
    }
    raw += decoder.decode();
  } catch {
    return reply({ error: "Unable to read the request." }, 400);
  }
  let input: unknown;
  try {
    input = JSON.parse(raw);
  } catch {
    return reply({ error: "Invalid request." }, 400);
  }
  const result = leadSchema.safeParse(input);
  if (!result.success)
    return reply(
      { error: "Please check your name, email, company and workflow details." },
      400,
    );
  const lead = result.data;
  if (lead.website)
    return reply({ error: "Unable to accept this request." }, 400);
  const apiKey = env.BREVO_API_KEY;
  const listId = Number(env.BREVO_FUNNEL_AUDIT_LIST_ID);
  if (
    !apiKey ||
    !Number.isSafeInteger(listId) ||
    listId <= 0 ||
    env.FUNNEL_FORMS_ENABLED !== "true"
  ) {
    return reply(
      {
        error:
          "Online requests are not available yet. Please email mail@zamdevai.com; your request has not been saved.",
      },
      503,
    );
  }
  // Intake only: no outgoing email is triggered by this public endpoint.
  // Do not unblock an existing subscriber, change global identity attributes,
  // enroll contacts in unrelated campaigns, or overwrite lifecycle stages.
  const attrs = {
    HIER_NAME: lead.name,
    HIER_COMPANY: lead.company,
    HIER_ICP: lead.segment,
    HIER_TEAM_SIZE: lead.teamSize,
    HIER_VOLUME: lead.weeklySubmissions,
    HIER_WORKFLOW: lead.workflow,
    HIER_PREFERRED_TIME: lead.preferredTime,
    HIER_SOURCE: lead.source,
    HIER_MEDIUM: lead.medium,
    HIER_CAMPAIGN: lead.campaign,
    HIER_SCORE: scoreLead(lead),
    HIER_REQUESTED_AT: new Date().toISOString(),
    HIER_PRIVACY_VERSION: "2026-09-05",
    HIER_MARKETING_REQUESTED: lead.marketingConsent,
  };
  try {
    const response = await fetch("https://api.brevo.com/v3/contacts", {
      method: "POST",
      cache: "no-store",
      signal: AbortSignal.timeout(12000),
      headers: { "api-key": apiKey, "content-type": "application/json" },
      body: JSON.stringify({
        email: lead.email,
        attributes: attrs,
        listIds: [listId],
        updateEnabled: true,
      }),
    });
    if (!response.ok) {
      console.error("[funnel] contact persistence failed", {
        status: response.status,
      });
      return reply(
        {
          error:
            "We couldn’t save your request. Please try again or email mail@zamdevai.com.",
        },
        502,
      );
    }
    return reply({ ok: true });
  } catch {
    // No request content, email address, or provider response is logged.
    return reply(
      {
        error:
          "We couldn’t confirm your request. Please email mail@zamdevai.com if retrying does not work.",
      },
      502,
    );
  }
}
