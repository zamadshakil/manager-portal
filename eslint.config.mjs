import { createRequire } from "node:module"

const require = createRequire(import.meta.url)
// eslint-config-next 16 ships a flat-config array directly via CommonJS.
// We import it through createRequire so we don't need the legacy
// FlatCompat bridge (which crashes on circular plugin references in v9).
const next = require("eslint-config-next")

/** @type {import("eslint").Linter.Config[]} */
const eslintConfig = [
  {
    ignores: [
      ".next/**",
      "node_modules/**",
      "out/**",
      "build/**",
      "dist/**",
      "scripts/**",
      "public/**",
      "next-env.d.ts",
      "tsconfig.tsbuildinfo",
    ],
  },
  ...next,
  {
    rules: {
      // Ban explicit `any` softly — many generated types fall back to any.
      "@typescript-eslint/no-explicit-any": "warn",
      // Underscore-prefixed unused vars are intentional placeholders.
      "@typescript-eslint/no-unused-vars": [
        "warn",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      "react/no-unescaped-entities": "off",
      "@next/next/no-html-link-for-pages": "off",
    },
  },
]

export default eslintConfig
