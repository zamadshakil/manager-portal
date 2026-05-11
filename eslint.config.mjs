import { createRequire } from "node:module"

const require = createRequire(import.meta.url)
// eslint-config-next 16 ships a flat-config array directly via CommonJS.
// We import it through createRequire so we don't need the legacy
// FlatCompat bridge (which crashes on circular plugin references in v9).
const next = require("eslint-config-next")
// In ESLint 9 flat-config, a plugin must be registered in the same config
// object that uses its rules. We load the package directly so the two
// @typescript-eslint rules below resolve correctly without relying on the
// plugin being re-exported by eslint-config-next.
const tsPlugin = require("@typescript-eslint/eslint-plugin")

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
    plugins: { "@typescript-eslint": tsPlugin },
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
