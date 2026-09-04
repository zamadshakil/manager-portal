/** Updates only the mailing-address line of the five inactive Hierarchia drafts. */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { parseEnv } from "node:util";
process.loadEnvFile(new URL("../.env.local", import.meta.url));
const local = parseEnv(await readFile(new URL("../.env.funnel.local", import.meta.url), "utf8"));
assert.equal(local.FUNNEL_MAILING_ADDRESS_COMPLETE, "true", "Complete the owner-supplied mailing address first");
const address = local.FUNNEL_MAILING_ADDRESS?.trim();
assert.ok(address && address.length < 500 && !/[\r\n]/.test(address));
assert.ok(process.env.BREVO_API_KEY, "BREVO_API_KEY is required");
const escapeHtml = (value) => value.replace(/[&<>"']/g, (c) => ({"&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;"})[c]);
const marker = /<p id="hierarchia-mailing-address"[^>]*>[\s\S]*?<\/p>/;
const anchor = '<p style="font-size:12px">You requested Hierarchia updates.';
const line = `<p id="hierarchia-mailing-address" style="font-size:12px">${escapeHtml(address)}</p>`;
const config = JSON.parse(await readFile(new URL("../docs/sales-assets/brevo-configuration.json", import.meta.url), "utf8"));
const entries = Object.entries(config.templates);
assert.deepEqual(entries.map(([, id]) => id).sort((a, b) => a - b), [13, 14, 15, 16, 17], "Unexpected target template IDs");
async function api(id, body) {
  const r = await fetch(`https://api.brevo.com/v3/smtp/templates/${id}`, {
    method: body ? "PUT" : "GET",
    headers: { "api-key": process.env.BREVO_API_KEY, "content-type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(20000),
  });
  assert.ok(r.ok, `Template ${id}: HTTP ${r.status}`);
  return r.status === 204 ? null : r.json();
}
const plans = [];
// Validate all targets before making any change. Preserve any separately edited copy.
for (const [name, id] of entries) {
  const before = await api(id);
  assert.equal(before.name, `Hierarchia | ${name}`);
  assert.equal(before.isActive, false, `Template ${id} is active; stop for review`);
  assert.ok(before.htmlContent.includes("{{ unsubscribe }}"), "Unsubscribe placeholder missing");
  assert.ok(marker.test(before.htmlContent) || before.htmlContent.includes(anchor), "Expected footer not found");
  const htmlContent = marker.test(before.htmlContent)
    ? before.htmlContent.replace(marker, () => line)
    : before.htmlContent.replace(anchor, () => line + anchor);
  plans.push({ id, before, htmlContent });
}
let updated = 0;
for (const { id, before, htmlContent } of plans) {
  const current = await api(id);
  assert.equal(current.isActive, false);
  assert.equal(current.htmlContent, before.htmlContent, `Template ${id} changed during preflight`);
  if (htmlContent !== current.htmlContent) {
    await api(id, { htmlContent, isActive: false });
    updated++;
  }
  const after = await api(id);
  assert.equal(after.isActive, false);
  assert.equal(after.htmlContent, htmlContent);
  assert.equal(after.subject, before.subject);
  assert.deepEqual(after.sender, before.sender);
  assert.equal(after.replyTo, before.replyTo);
  console.log(`Template ${id}: address verified; inactive; sender and copy preserved.`);
}
console.log(JSON.stringify({ updated, verified: plans.length, emailsSent: 0 }));
