import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
function load(file, deps = {}) {
  const source = readFileSync(new URL(file, import.meta.url), "utf8");
  const js = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText;
  const exports = {};
  const sandbox = {
    exports,
    require: (n) => deps[n] || require(n),
    process: {
      env: {
        NODE_ENV: "production",
        NEXT_PUBLIC_SITE_URL: "https://showcase.example.com",
        FUNNEL_FORMS_ENABLED: "true",
        BREVO_API_KEY: "test-key",
        BREVO_FUNNEL_AUDIT_LIST_ID: "10",
      },
    },
    Response,
    Request,
    TextDecoder,
    AbortSignal,
    console: { error() {} },
    fetch: async () => new Response("{}", { status: 201 }),
    ...deps.globals,
  };
  vm.runInNewContext(js, sandbox, { filename: file });
  return { exports, sandbox };
}
const { exports: funnel } = load("../lib/funnel.ts");
const lead = {
  name: "Test Person",
  email: "  TEST@example.com ",
  company: "Test Company",
  segment: "agencies",
  teamSize: 30,
  weeklySubmissions: 80,
  workflow: "Review our weekly client reports.",
  privacyAccepted: true,
  marketingConsent: false,
  website: "",
};
test("lead validation normalizes email and preserves opt-out", () => {
  const v = funnel.leadSchema.parse(lead);
  assert.equal(v.email, "test@example.com");
  assert.equal(v.marketingConsent, false);
});
test("consent, email and numeric limits are enforced", () => {
  for (const patch of [
    { privacyAccepted: false },
    { email: "broken" },
    { teamSize: 0 },
    { weeklySubmissions: 100001 },
    { workflow: "short" },
    { segment: "bogus" },
  ])
    assert.equal(
      funnel.leadSchema.safeParse({ ...lead, ...patch }).success,
      false,
    );
});
test("fit scores are bounded and prioritize the primary ICP", () => {
  assert.equal(funnel.scoreLead(lead), 100);
  assert.equal(
    funnel.scoreLead({
      ...lead,
      segment: "other",
      teamSize: 2,
      weeklySubmissions: 1,
    }),
    10,
  );
});
test("workload calculation separates baseline and hypothetical savings", () => {
  const r = funnel.reviewEstimate(80, 12, 25, 20);
  assert.equal(r.baseHours, 16);
  assert.equal(r.reworkHours, 4);
  assert.equal(r.totalHours, 20);
  assert.equal(r.potentialHours, 4);
  assert.equal(funnel.reviewEstimate(0, 0, 0, 0).totalHours, 0);
});
function route(globals) {
  const m = load("../lib/funnel-intake.ts", { "./funnel": funnel, globals });
  return (request) =>
    m.exports.handleLeadRequest(request, m.sandbox.process.env);
}
function req(body = lead, origin = "https://showcase.example.com") {
  return new Request("https://showcase.example.com/api/funnel/leads", {
    method: "POST",
    headers: { origin, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}
test("untrusted origins are rejected before provider writes", async () => {
  let calls = 0;
  const post = route({
    fetch: async () => {
      calls++;
      return new Response("{}");
    },
  });
  assert.equal((await post(req(lead, "https://attacker.test"))).status, 403);
  assert.equal(calls, 0);
});
test("an explicitly configured backup origin is accepted", async () => {
  const post = route({process: {env: {
    NODE_ENV: "production", NEXT_PUBLIC_SITE_URL: "https://showcase.example.com",
    FUNNEL_ALTERNATE_ORIGIN: "https://backup.workers.dev", FUNNEL_FORMS_ENABLED: "true",
    BREVO_API_KEY: "test-key", BREVO_FUNNEL_AUDIT_LIST_ID: "10"
  }}});
  assert.equal((await post(req(lead, "https://backup.workers.dev"))).status, 200);
  assert.equal((await post(req(lead, "https://another.workers.dev"))).status, 403);
});
test("oversized and malformed payloads are rejected", async () => {
  const post = route();
  assert.equal(
    (await post(req({ ...lead, workflow: "x".repeat(9000) }))).status,
    413,
  );
  assert.equal((await post(req({ ...lead, email: "invalid" }))).status, 400);
  assert.equal((await post(req({ ...lead, website: "spam" }))).status, 400);
});
test("missing provider config fails closed", async () => {
  const post = route({
    process: {
      env: {
        NODE_ENV: "production",
        NEXT_PUBLIC_SITE_URL: "https://showcase.example.com",
      },
    },
  });
  assert.equal((await post(req())).status, 503);
});
test("provider failure is not reported as success", async () => {
  const post = route({
    fetch: async () => new Response("sensitive provider text", { status: 500 }),
  });
  const res = await post(req());
  assert.equal(res.status, 502);
  assert.equal((await res.text()).includes("sensitive"), false);
});
test("successful intake writes only its scoped list; no email or marketing enrollment", async () => {
  const calls = [];
  const post = route({
    fetch: async (url, options) => {
      calls.push({ url, body: JSON.parse(options.body) });
      return new Response("{}", { status: 201 });
    },
  });
  const res = await post(req());
  assert.equal(res.status, 200);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "https://api.brevo.com/v3/contacts");
  assert.deepEqual(calls[0].body.listIds, [10]);
  assert.equal(calls[0].body.attributes.HIER_MARKETING_REQUESTED, false);
  assert.equal(calls[0].body.emailBlacklisted, undefined);
  assert.equal(calls[0].body.attributes.HIER_STAGE, undefined);
});
