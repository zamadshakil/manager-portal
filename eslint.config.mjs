import nextCoreWebVitals from "eslint-config-next/core-web-vitals"
import nextTypescript from "eslint-config-next/typescript"

/**
 * ESLint flat config (v9+). Next 16 ships native flat configs so we no
 * longer need FlatCompat. This actually exercises Next's recommended
 * TypeScript + React rules instead of running with zero rules as `pnpm
 * lint` did before.
 */
export default [
  {
    ignores: [
      ".next/**",
      "node_modules/**",
      "next-env.d.ts",
      "public/**",
      "scripts/**/*.sql",
      "user_read_only_context/**",
      "v0_memories/**",
    ],
  },
  ...nextCoreWebVitals,
  ...nextTypescript,
  {
    rules: {
      // `lib/supabase/database.types.ts` is intentionally `any`; `lib/data.ts`
      // uses `as unknown as ...` casts. Demote to warnings rather than
      // blocking CI until a typed Supabase client is generated.
      "@typescript-eslint/no-explicit-any": "warn",
      "@typescript-eslint/no-unused-vars": [
        "warn",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
        },
      ],
    },
  },
]
