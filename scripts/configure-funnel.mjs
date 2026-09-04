/** Idempotent Brevo setup; no contacts imported and no emails sent. */
import { readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
const root = new URL("../", import.meta.url),
  envPath = new URL(".env.local", root);
if (existsSync(envPath)) process.loadEnvFile(envPath);
const key = process.env.BREVO_API_KEY;
if (!key) throw Error("BREVO_API_KEY is required");
const headers = {
  "api-key": key,
  "content-type": "application/json",
  accept: "application/json",
};
async function api(path, method = "GET", body) {
  const r = await fetch(`https://api.brevo.com/v3${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(20000),
  });
  if (!r.ok) throw Error(`${method} ${path} failed (${r.status})`);
  return r.status === 204 ? {} : r.json();
}
const prefix = "Hierarchia | ";
const folders = await api("/contacts/folders?limit=50&offset=0");
let folder = folders.folders.find((f) => f.name === prefix + "Sales funnel");
if (!folder)
  folder = await api("/contacts/folders", "POST", {
    name: prefix + "Sales funnel",
  });
const existing = await api(
  `/contacts/folders/${folder.id}/lists?limit=50&offset=0`,
);
const lists = {};
for (const name of [
  "Audit requests",
  "Opt-in nurture",
  "Qualified pilots",
  "Customers",
  "Do not contact",
]) {
  const found = (existing.lists || []).find((l) => l.name === prefix + name);
  lists[name] =
    found?.id ||
    (
      await api("/contacts/lists", "POST", {
        name: prefix + name,
        folderId: folder.id,
      })
    ).id;
}
const attrs = {
  HIER_NAME: "text",
  HIER_COMPANY: "text",
  HIER_ICP: "text",
  HIER_TEAM_SIZE: "float",
  HIER_VOLUME: "float",
  HIER_WORKFLOW: "text",
  HIER_PREFERRED_TIME: "text",
  HIER_SOURCE: "text",
  HIER_MEDIUM: "text",
  HIER_CAMPAIGN: "text",
  HIER_SCORE: "float",
  HIER_REQUESTED_AT: "text",
  HIER_PRIVACY_VERSION: "text",
  HIER_MARKETING_REQUESTED: "boolean",
  HIER_STAGE: "text",
  HIER_OWNER: "text",
  HIER_NEXT_STEP: "text",
  HIER_NEXT_STEP_DATE: "date",
  HIER_CONSENT_CONFIRMED: "boolean",
  HIER_STOP_FOLLOWUP: "boolean",
};
const current = await api("/contacts/attributes");
for (const [name, type] of Object.entries(attrs)) {
  const found = current.attributes.find((a) => a.name === name);
  if (found && found.type !== type)
    throw Error(`Existing attribute type conflict: ${name}`);
  if (!found)
    await api(`/contacts/attributes/normal/${name}`, "POST", { type });
}
const templatesData = JSON.parse(
  await readFile(
    new URL("docs/sales-assets/email-sequences.json", root),
    "utf8",
  ),
);
const oldTemplates = await api("/smtp/templates?limit=100&offset=0");
const templates = {};
for (const t of templatesData) {
  const name = prefix + t.name;
  const found = (oldTemplates.templates || []).find((x) => x.name === name);
  const html = `<!doctype html><html><body style="font:16px/1.65 Arial;color:#122724;max-width:600px;margin:30px auto"><p>Hi {{ contact.HIER_NAME | default : 'there' }},</p>${t.paragraphs.map((p) => `<p>${p}</p>`).join("")}<p>Zamad Shakeel<br>ZamDev AI<br><a href="mailto:mail@zamdevai.com">mail@zamdevai.com</a></p><p style="font-size:12px">You requested Hierarchia updates. <a href="{{ unsubscribe }}">Unsubscribe</a>.</p></body></html>`;
  templates[t.name] =
    found?.id ||
    (
      await api("/smtp/templates", "POST", {
        templateName: name,
        subject: t.subject,
        sender: { name: "Zamad at ZamDev AI", email: "mail@zamdevai.com" },
        replyTo: "mail@zamdevai.com",
        htmlContent: html,
        isActive: false,
        tag: "hierarchia-funnel",
      })
    ).id;
}
const config = {
  verifiedAt: new Date().toISOString(),
  folderId: folder.id,
  lists,
  attributes: Object.keys(attrs),
  templates,
  automaticSending: false,
  notes:
    "Draft templates only. No contacts imported. Confirmed opt-in, mailing address and unsubscribe QA required before activating nurture.",
};
await writeFile(
  new URL("docs/sales-assets/brevo-configuration.json", root),
  JSON.stringify(config, null, 2) + "\n",
);
let env = await readFile(envPath, "utf8");
for (const [name, value] of Object.entries({
  BREVO_FUNNEL_AUDIT_LIST_ID: lists["Audit requests"],
  BREVO_FUNNEL_NURTURE_LIST_ID: lists["Opt-in nurture"],
  BREVO_SENDER_EMAIL: "mail@zamdevai.com",
  BREVO_SENDER_NAME: "Zamad at ZamDev AI",
  SHOWCASE_SITE_ENABLED: "true",
  FUNNEL_FORMS_ENABLED: "true",
})) {
  env =
    env
      .split(/\r?\n/)
      .filter((l) => !l.startsWith(name + "="))
      .join("\n")
      .trimEnd() + `\n${name}=${value}\n`;
}
await writeFile(envPath, env, { mode: 0o600 });
// Read-back counts are scoped; never output account contact data or API keys.
const check = await api(
  `/contacts/folders/${folder.id}/lists?limit=50&offset=0`,
);
console.log(
  JSON.stringify({
    folderId: folder.id,
    lists: check.lists.map((l) => ({ id: l.id, name: l.name })),
    attributesCreatedOrReused: Object.keys(attrs).length,
    draftTemplateIds: templates,
    emailsSent: 0,
  }),
);
