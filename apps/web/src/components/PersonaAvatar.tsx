/**
 * Deterministic generated avatar — initials on a gradient derived from the
 * persona's accent + seed. No external avatar service (nothing leaves the app).
 */
function hashHue(seed: string): number {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  return h % 360;
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

export function PersonaAvatar({
  name,
  accent,
  seed,
  size = 40,
  square = false,
}: {
  name: string;
  accent: string;
  seed?: string;
  size?: number;
  square?: boolean;
}) {
  const hue2 = hashHue(seed ?? name);
  const bg = `linear-gradient(140deg, ${accent}, hsl(${hue2} 70% 55%))`;
  return (
    <span
      className={`pav${square ? " sq" : ""}`}
      aria-hidden
      style={{
        width: size,
        height: size,
        fontSize: size * 0.38,
        background: bg,
      }}
    >
      {initials(name)}
    </span>
  );
}
