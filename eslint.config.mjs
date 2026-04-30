import { dirname } from "path"
import { fileURLToPath } from "url"
import { FlatCompat } from "@eslint/eslintrc"

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

const compat = new FlatCompat({ baseDirectory: __dirname })

/**
 * Flat-config ESLint setup for Next.js 16. We extend Next's recommended
 * preset which already includes core-web-vitals + React Hooks + TypeScript
 * rules. Add overrides below as the project's conventions evolve.
 */
const eslintConfig = [
  ...compat.extends("next/core-web-vitals", "next/typescript"),
  {
    ignores: [
      ".next/**",
      "node_modules/**",
      "scripts/**",
      "public/**",
      "next-env.d.ts",
      "tsconfig.tsbuildinfo",
    ],
  },
  {
    rules: {
      // Ban explicit `any` softly — the audit found `Database` types use any
      // by design, and a hard error here would block migration. Warn keeps
      // the issue visible without blocking CI.
      "@typescript-eslint/no-explicit-any": "warn",
      // Unused vars are common during refactors — warn instead of error and
      // allow underscore-prefixed names as an opt-out.
      "@typescript-eslint/no-unused-vars": [
        "warn",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      "react/no-unescaped-entities": "off",
    },
  },
]

export default eslintConfig
