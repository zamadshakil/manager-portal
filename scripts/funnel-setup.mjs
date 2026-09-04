/** Local-only, single-use credential intake. Never prints credentials.
 * Run: node scripts/funnel-setup.mjs
 * This stores only the submitted provider keys in gitignored .env.local.
 * Configuration is idempotent and scoped to Hierarchia assets.
 */
import http from "node:http";
import { randomBytes } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
const nonce = randomBytes(24).toString("hex");
const root = new URL("../", import.meta.url);
const envPath = new URL(".env.local", root);
const origin = "http://127.0.0.1:3388";
let busy = false;
const server = http.createServer(async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader(
    "Content-Security-Policy",
    "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'",
  );
  if (req.url !== `/setup/${nonce}`) {
    res.writeHead(404).end();
    return;
  }
  if (req.method === "GET") {
    res.setHeader("Content-Type", "text/html");
    res.end(
      '<!doctype html><html><title>Hierarchia local setup</title><body style="font:18px Arial;padding:50px;max-width:600px"><h1>Hierarchia local setup</h1><p>Keys stay on this computer and are excluded from Git. No key is shown in logs.</p><form method="post"><p><label>Brevo API key <input type="password" name="brevo" autocomplete="off"></label></p><p><label>Vercel token (optional) <input type="password" name="vercel" autocomplete="off"></label></p><button>Save configuration</button></form></body></html>',
    );
    return;
  }
  if (req.method !== "POST" || req.headers.origin !== origin || busy) {
    res.writeHead(403).end();
    return;
  }
  busy = true;
  try {
    let raw = "";
    for await (const c of req) {
      raw += c.toString();
      if (Buffer.byteLength(raw) > 4096) throw Error("Request too large");
    }
    const data = new URLSearchParams(raw),
      key = data.get("brevo"),
      token = data.get("vercel");
    if (key && !/^xkeysib-[A-Za-z0-9-]+$/.test(key))
      throw Error("Invalid Brevo key");
    if (token && !/^[A-Za-z0-9_-]+$/.test(token))
      throw Error("Invalid Vercel token");
    let env = existsSync(envPath) ? await readFile(envPath, "utf8") : "";
    for (const [name, value] of [
      ["BREVO_API_KEY", key],
      ["VERCEL_TOKEN", token],
    ]) {
      if (!value) continue;
      env =
        env
          .split(/\r?\n/)
          .filter((l) => !l.startsWith(name + "="))
          .join("\n")
          .trimEnd() + `\n${name}=${value}\n`;
    }
    await writeFile(envPath, env, { mode: 0o600 });
    res.setHeader("Content-Type", "text/html");
    res.end(
      "<h1>Configuration saved locally</h1><p>No credentials were printed or committed.</p>",
    );
    console.log("Provider credentials saved to gitignored local environment.");
    server.close();
  } catch (e) {
    res.writeHead(400).end("Configuration was not saved. Check the fields.");
    busy = false;
    console.error("Local setup failed; credential values withheld.");
  }
});
server.listen(3388, "127.0.0.1", () => console.log(`${origin}/setup/${nonce}`));
setTimeout(() => server.close(), 15 * 60 * 1000).unref();
