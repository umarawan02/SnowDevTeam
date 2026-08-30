/** Donut chart + legend. */
export function Donut({
  segments,
  size = 108,
  format = (n: number) => String(n),
}: {
  segments: { label: string; value: number; color: string }[];
  size?: number;
  format?: (n: number) => string;
}) {
  const total = segments.reduce((a, s) => a + s.value, 0);
  const r = size / 2 - 8;
  const cx = size / 2;
  const cy = size / 2;
  const circ = 2 * Math.PI * r;
  let offset = 0;

  return (
    <div className="donut">
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img" aria-label="Breakdown">
        <circle cx={cx} cy={cy} r={r} fill="none" stroke="var(--surface-3)" strokeWidth={10} />
        {total > 0 &&
          segments.map((s) => {
            const frac = s.value / total;
            const dash = frac * circ;
            const el = (
              <circle
                key={s.label}
                cx={cx}
                cy={cy}
                r={r}
                fill="none"
                stroke={s.color}
                strokeWidth={10}
                strokeDasharray={`${dash} ${circ - dash}`}
                strokeDashoffset={-offset}
                transform={`rotate(-90 ${cx} ${cy})`}
                strokeLinecap="butt"
              />
            );
            offset += dash;
            return el;
          })}
      </svg>
      <div className="legend">
        {segments.map((s) => (
          <div className="li" key={s.label}>
            <span className="sw" style={{ background: s.color }} />
            {s.label}
            <span className="lv">{format(s.value)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
