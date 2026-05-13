/**
 * Convert a Markdown file to PDF using Edge headless.
 * Usage: node scripts/md-to-pdf.mjs <input.md> [output.pdf]
 */
import { readFileSync, writeFileSync, unlinkSync } from "fs";
import { resolve, dirname, basename, extname } from "path";
import { fileURLToPath } from "url";
import { execSync } from "child_process";
import { marked } from "marked";
import os from "os";

const __dirname = dirname(fileURLToPath(import.meta.url));

const inputArg = process.argv[2];
if (!inputArg) {
  console.error("Usage: node scripts/md-to-pdf.mjs <input.md> [output.pdf]");
  process.exit(1);
}

const inputPath = resolve(inputArg);
const outputPath = process.argv[3]
  ? resolve(process.argv[3])
  : resolve(
      dirname(inputPath),
      basename(inputPath, extname(inputPath)) + ".pdf"
    );

const md = readFileSync(inputPath, "utf8");

// ── Extract cover metadata ─────────────────────────────────────────────────
// Pull out the leading H1, first blockquote, and the following --- from the
// markdown so they don't appear again in the body.

// 1. Title from first H1
const titleMatch = md.match(/^#\s+(.+)/m);
const rawTitle = titleMatch ? titleMatch[1].trim() : basename(inputPath, extname(inputPath));
// Split on " — " or " - " for a two-line cover heading
const titleParts = rawTitle.split(/\s[—–-]\s/);
const coverTitle =
  titleParts.length > 1
    ? `${titleParts[0]}<br/>${titleParts.slice(1).join(" — ")}`
    : rawTitle;

// 2. First blockquote lines → key/value pairs
const bqMatch = md.match(/^((?:>.*\n?)+)/m);
const coverMetaLines = [];
if (bqMatch) {
  bqMatch[1].split("\n").forEach((line) => {
    const text = line.replace(/^>\s*/, "").trim();
    if (!text) return;
    // Strip markdown bold markers for plain display, keep structure
    coverMetaLines.push(text.replace(/\*\*/g, ""));
  });
}
const coverMetaHtml = coverMetaLines
  .map((l) => {
    const kv = l.match(/^([^:]+):\s*(.+)$/);
    if (kv) return `<strong>${kv[1].trim()}:</strong> ${kv[2].trim()}<br/>`;
    return `${l}<br/>`;
  })
  .join("\n    ");

// 3. Strip H1 + first blockquote block + first trailing --- from body markdown
let bodyMd = md
  .replace(/^#\s+.+\n?/, "")           // remove H1
  .replace(/^((?:>.*\n?)+)\n?/, "")    // remove first blockquote
  .replace(/^---\n?/, "");             // remove first hr

// Configure marked for GFM
marked.setOptions({ gfm: true, breaks: false });

const bodyHtml = marked.parse(bodyMd);

const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>${rawTitle}</title>
<style>
  /* ── Reset & base ─────────────────────────────────────────── */
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

  :root {
    --accent:    #1a56db;
    --accent-lt: #e8efff;
    --border:    #d1d5db;
    --code-bg:   #f3f4f6;
    --text:      #111827;
    --muted:     #6b7280;
    --page-w:    170mm;
  }

  @page {
    size: A4;
    margin: 22mm 20mm 25mm 20mm;
    @bottom-center {
      content: counter(page);
      font-family: "Segoe UI", sans-serif;
      font-size: 9pt;
      color: var(--muted);
    }
  }

  html { font-size: 10.5pt; }

  body {
    font-family: "Segoe UI", "Helvetica Neue", Arial, sans-serif;
    color: var(--text);
    line-height: 1.65;
    max-width: var(--page-w);
    margin: 0 auto;
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }

  /* ── Cover page ───────────────────────────────────────────── */
  .cover {
    page-break-after: always;
    display: flex;
    flex-direction: column;
    justify-content: center;
    min-height: 200mm;
    padding: 20mm 0;
    border-bottom: 3px solid var(--accent);
  }
  .cover .label {
    font-size: 9pt;
    text-transform: uppercase;
    letter-spacing: .12em;
    color: var(--muted);
    margin-bottom: 10mm;
  }
  .cover h1 {
    font-size: 26pt;
    font-weight: 700;
    color: var(--accent);
    line-height: 1.2;
    margin-bottom: 6mm;
    border: none;
    padding: 0;
  }
  .cover .meta {
    font-size: 10pt;
    color: var(--muted);
    margin-top: 8mm;
    line-height: 1.8;
  }
  .cover .meta strong { color: var(--text); }

  /* ── Typography ───────────────────────────────────────────── */
  h1, h2, h3, h4, h5, h6 {
    font-family: "Segoe UI", "Helvetica Neue", Arial, sans-serif;
    font-weight: 600;
    line-height: 1.25;
    color: var(--text);
    margin-top: 1.8em;
    margin-bottom: .5em;
    page-break-after: avoid;
  }

  /* H1 title was stripped from body markdown — nothing to hide */

  h1 {
    font-size: 18pt;
    font-weight: 700;
    color: var(--accent);
    border-bottom: 2px solid var(--accent);
    padding-bottom: .35em;
    margin-top: 2em;
  }
  h2 {
    font-size: 14pt;
    font-weight: 700;
    color: var(--accent);
    border-bottom: 1px solid var(--border);
    padding-bottom: .25em;
  }
  h3 { font-size: 12pt; font-weight: 600; color: #1e3a8a; }
  h4 { font-size: 11pt; font-weight: 600; color: #374151; }
  h5 { font-size: 10.5pt; font-weight: 600; }
  h6 { font-size: 10pt; font-weight: 600; color: var(--muted); }

  p {
    margin-top: 0;
    margin-bottom: .75em;
    orphans: 3;
    widows: 3;
  }

  /* ── Blockquotes ──────────────────────────────────────────── */
  blockquote {
    border-left: 4px solid var(--accent);
    background: var(--accent-lt);
    margin: 1em 0;
    padding: .7em 1em;
    border-radius: 0 4px 4px 0;
    color: #1e3a8a;
    font-style: normal;
  }
  blockquote p { margin-bottom: 0; }
  blockquote strong { color: #1e40af; }

  /* ── Lists ────────────────────────────────────────────────── */
  ul, ol {
    margin: .5em 0 .75em 1.5em;
    padding: 0;
  }
  li { margin-bottom: .25em; }
  li > ul, li > ol { margin-top: .2em; margin-bottom: .2em; }

  /* ── Code ─────────────────────────────────────────────────── */
  code {
    font-family: "Cascadia Code", "Consolas", "Courier New", monospace;
    font-size: 9pt;
    background: var(--code-bg);
    border: 1px solid var(--border);
    border-radius: 3px;
    padding: .1em .35em;
  }
  pre {
    background: #1e293b;
    border-radius: 6px;
    padding: .9em 1.1em;
    overflow-x: auto;
    margin: .75em 0 1em;
    page-break-inside: avoid;
  }
  pre code {
    background: none;
    border: none;
    padding: 0;
    color: #e2e8f0;
    font-size: 8.5pt;
    line-height: 1.55;
  }

  /* ── Tables ───────────────────────────────────────────────── */
  table {
    width: 100%;
    border-collapse: collapse;
    margin: .75em 0 1em;
    font-size: 9.5pt;
    page-break-inside: avoid;
  }
  th {
    background: var(--accent);
    color: #fff;
    font-weight: 600;
    padding: .45em .7em;
    text-align: left;
  }
  td {
    padding: .4em .7em;
    border-bottom: 1px solid var(--border);
    vertical-align: top;
  }
  tr:nth-child(even) td { background: #f9fafb; }
  tr:last-child td { border-bottom: 2px solid var(--border); }

  /* ── Horizontal rules ─────────────────────────────────────── */
  hr {
    border: none;
    border-top: 1px solid var(--border);
    margin: 1.5em 0;
  }

  /* ── Links ────────────────────────────────────────────────── */
  a { color: var(--accent); text-decoration: none; }
  a:hover { text-decoration: underline; }

  /* ── Print helpers ────────────────────────────────────────── */
  h1, h2 { page-break-before: auto; }
  table, figure, pre { page-break-inside: avoid; }

  @media print {
    body { max-width: 100%; }
    a { color: var(--accent) !important; }
  }
</style>
</head>
<body>

<!-- Cover Page -->
<div class="cover">
  <div class="label">Client Delivery Document</div>
  <h1>${coverTitle}</h1>
  <div class="meta">
    ${coverMetaHtml}
  </div>
</div>

<!-- Document Body -->
<div class="content">
${bodyHtml}
</div>

</body>
</html>`;

// Write temp HTML
const tmpHtml = resolve(os.tmpdir(), `_md2pdf_${Date.now()}.html`);
writeFileSync(tmpHtml, html, "utf8");

// Edge paths to try
const edgePaths = [
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
  "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
];
const edgeBin = edgePaths.find((p) => {
  try { execSync(`"${p}" --version`, { stdio: "pipe" }); return true; } catch { return false; }
});

if (!edgeBin) {
  console.error("Microsoft Edge not found. Saved styled HTML to:", tmpHtml);
  process.exit(1);
}

console.log(`Converting: ${inputPath}`);
console.log(`Output:     ${outputPath}`);

try {
  execSync(
    `"${edgeBin}" --headless=new --disable-gpu --no-sandbox ` +
      `--run-all-compositor-stages-before-draw ` +
      `--print-to-pdf="${outputPath}" ` +
      `--print-to-pdf-no-header ` +
      `"file:///${tmpHtml.replace(/\\/g, "/")}"`,
    { stdio: "inherit", timeout: 60_000 }
  );
  console.log("Done!");
} catch (err) {
  console.error("Edge headless failed:", err.message);
  process.exit(1);
} finally {
  try { unlinkSync(tmpHtml); } catch {}
}
