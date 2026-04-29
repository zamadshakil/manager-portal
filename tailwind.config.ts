import type { Config } from "tailwindcss"

/**
 * In Tailwind CSS v4 the design tokens (colors, radii, shadows, fonts) are
 * declared via `@theme` inside `app/globals.css` — that's the single source
 * of truth. This config used to redeclare every color from the CSS variables
 * which meant any token added to `globals.css` had to be added here too,
 * leading to drift.
 *
 * v4 also auto-detects content roots, so `content` is optional in most
 * setups, but we keep an explicit allow-list to make scanning predictable
 * for monorepo / shared-package scenarios.
 */
const config: Config = {
  content: [
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
    "./lib/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  plugins: [],
}

export default config
