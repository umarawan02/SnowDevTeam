/** The gradient sphere — lime → electric-blue → violet. Empty state + assistant avatar. */
export function StarterOrb({ size = 92 }: { size?: number }) {
  return (
    <span
      className="orb"
      aria-hidden
      style={{
        width: size,
        height: size,
        borderRadius: "50%",
        display: "inline-block",
        background: `
          radial-gradient(circle at 30% 28%, rgba(255,255,255,0.9), rgba(255,255,255,0) 38%),
          radial-gradient(circle at 72% 32%, var(--lime-bright), rgba(163,230,53,0) 55%),
          radial-gradient(circle at 32% 78%, var(--accent-bright), rgba(75,131,255,0) 60%),
          radial-gradient(circle at 78% 80%, var(--violet), rgba(139,92,246,0) 58%),
          linear-gradient(145deg, var(--accent), var(--violet))
        `,
        boxShadow: "0 10px 34px -12px var(--accent-line), inset 0 2px 10px rgba(255,255,255,0.35)",
      }}
    />
  );
}
