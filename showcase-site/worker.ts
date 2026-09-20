import { handleLeadRequest } from "../lib/funnel-intake";
export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    // Direct edge redirect for legacy showcase demo & login routes to real live portal
    const normalizedPath = url.pathname.replace(/\/+$/, "");
    if (
      normalizedPath === "/showcase/demo" ||
      normalizedPath === "/showcase/demo/member" ||
      normalizedPath === "/auth/login"
    ) {
      return Response.redirect("https://hirarchia.zamdevai.com/auth/login", 307);
    }

    if (url.pathname === "/api/funnel/leads") {
      if (request.method !== "POST")
        return Response.json(
          { error: "Method not allowed" },
          {
            status: 405,
            headers: { Allow: "POST", "Cache-Control": "no-store" },
          },
        );
      try {
        // Anonymous form: shared networks may hit this per-location abuse cap.
        // Cloudflare supplies this header. It is not used as user identity.
        const ip = request.headers.get("CF-Connecting-IP") || "unknown";
        const { success } = await env.LEAD_RATE_LIMIT.limit({
          key: `hierarchia-intake:${ip}`,
        });
        if (!success)
          return Response.json(
            { error: "Too many requests. Please wait a minute and try again." },
            {
              status: 429,
              headers: { "Retry-After": "60", "Cache-Control": "no-store" },
            },
          );
        return await handleLeadRequest(request, {
          NODE_ENV: "production",
          NEXT_PUBLIC_SITE_URL: env.NEXT_PUBLIC_SITE_URL,
          FUNNEL_ALTERNATE_ORIGIN: env.FUNNEL_ALTERNATE_ORIGIN,
          BREVO_API_KEY: env.BREVO_API_KEY,
          BREVO_FUNNEL_AUDIT_LIST_ID: env.BREVO_FUNNEL_AUDIT_LIST_ID,
          FUNNEL_FORMS_ENABLED: env.FUNNEL_FORMS_ENABLED,
        });
      } catch {
        return Response.json(
          {
            error:
              "Online requests are temporarily unavailable. Please email mail@zamdevai.com.",
          },
          { status: 503, headers: { "Cache-Control": "no-store" } },
        );
      }
    }
    if (url.pathname.startsWith("/api/"))
      return new Response("Not found", { status: 404 });
    return env.ASSETS.fetch(request);
  },
} satisfies ExportedHandler<Env>;
