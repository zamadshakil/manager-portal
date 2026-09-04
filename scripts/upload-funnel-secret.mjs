import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
process.loadEnvFile(new URL("../.env.local", import.meta.url));
const key = process.env.BREVO_API_KEY;
if (!key) throw Error("Missing local Brevo credential");
const child = spawn(
  process.execPath,
  [
    fileURLToPath(
      new URL("../node_modules/wrangler/bin/wrangler.js", import.meta.url),
    ),
    "secret",
    "put",
    "BREVO_API_KEY",
    "--config",
    "showcase-site/wrangler.jsonc",
  ],
  {
    cwd: fileURLToPath(new URL("../", import.meta.url)),
    stdio: ["pipe", "inherit", "inherit"],
  },
);
child.stdin.end(key + "\n");
child.on("exit", (code) => (process.exitCode = code || 0));
