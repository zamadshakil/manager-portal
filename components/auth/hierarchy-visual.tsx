/**
 * Decorative org-chart / hierarchy visualization for the auth shell.
 *
 * This is the "subtle visual cue that reflects the essence of the
 * software's purpose" — Hierarchia is an AI-driven *hierarchy* portal,
 * so the right pane shows an abstract three-level org tree built from
 * geometric primitives. Pure SVG, no images, fully theme-aware via
 * design tokens (currentColor + opacity), and decorative-only so it's
 * marked aria-hidden.
 */
export function HierarchyVisual({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 480 360"
      role="img"
      aria-hidden="true"
      className={className}
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      {/* ------- connector lines ------- */}
      <g
        stroke="currentColor"
        strokeWidth="1.25"
        strokeLinecap="round"
        className="text-foreground/20"
      >
        {/* root -> mid */}
        <path d="M240 86 V128 H120 V172" />
        <path d="M240 128 V172" />
        <path d="M240 86 V128 H360 V172" />

        {/* mid-left -> leaves */}
        <path d="M120 218 V258 H64 V296" />
        <path d="M120 258 V296" />

        {/* mid-center -> leaves */}
        <path d="M240 218 V258 H192 V296" />
        <path d="M240 258 V296" />
        <path d="M240 218 V258 H288 V296" />

        {/* mid-right -> leaves */}
        <path d="M360 218 V258 H416 V296" />
        <path d="M360 258 V296" />
      </g>

      {/* ------- root node (filled primary, with soft halo) ------- */}
      <g>
        <circle
          cx="240"
          cy="60"
          r="34"
          className="fill-primary/10"
        />
        <circle
          cx="240"
          cy="60"
          r="22"
          className="fill-primary"
        />
        {/* tiny ping pulse — uses Tailwind's animate-ping under a clip mask */}
        <circle
          cx="240"
          cy="60"
          r="22"
          className="fill-primary/40 origin-center [animation:ping_2.4s_cubic-bezier(0,0,0.2,1)_infinite]"
        />
      </g>

      {/* ------- mid level (outlined primary) ------- */}
      {[
        { cx: 120, cy: 196 },
        { cx: 240, cy: 196 },
        { cx: 360, cy: 196 },
      ].map((n, i) => (
        <g key={`mid-${i}`}>
          <circle
            cx={n.cx}
            cy={n.cy}
            r="20"
            className="fill-background stroke-primary/70"
            strokeWidth="1.5"
          />
          <circle
            cx={n.cx}
            cy={n.cy}
            r="6"
            className="fill-primary/80"
          />
        </g>
      ))}

      {/* ------- leaf level (muted outlined) ------- */}
      {[
        { cx: 64, cy: 320 },
        { cx: 120, cy: 320 },
        { cx: 192, cy: 320 },
        { cx: 240, cy: 320 },
        { cx: 288, cy: 320 },
        { cx: 360, cy: 320 },
        { cx: 416, cy: 320 },
      ].map((n, i) => (
        <circle
          key={`leaf-${i}`}
          cx={n.cx}
          cy={n.cy}
          r="14"
          className="fill-background stroke-foreground/25"
          strokeWidth="1.25"
        />
      ))}
    </svg>
  )
}
