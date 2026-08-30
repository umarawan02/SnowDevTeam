/** Hand-rolled responsive area chart. Pure SVG, no dependency. */
export function AreaChart({
  data,
  height = 120,
}: {
  data: { label: string; count: number }[];
  height?: number;
}) {
  const W = 640;
  const H = height;
  const pad = { t: 10, r: 6, b: 18, l: 6 };
  const iw = W - pad.l - pad.r;
  const ih = H - pad.t - pad.b;
  const max = Math.max(1, ...data.map((d) => d.count));
  const n = data.length;

  const x = (i: number) => pad.l + (n <= 1 ? iw / 2 : (i / (n - 1)) * iw);
  const y = (v: number) => pad.t + ih - (v / max) * ih;

  const pts = data.map((d, i) => `${x(i).toFixed(1)},${y(d.count).toFixed(1)}`);
  const line = `M ${pts.join(" L ")}`;
  const area = `${line} L ${x(n - 1).toFixed(1)},${(pad.t + ih).toFixed(1)} L ${x(0).toFixed(1)},${(pad.t + ih).toFixed(1)} Z`;
  const last = data[n - 1];

  return (
    <div className="chartwrap chart-area">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Requests per day, last 14 days">
        <line className="grid" x1={pad.l} y1={pad.t + ih} x2={W - pad.r} y2={pad.t + ih} />
        <path className="fill" d={area} />
        <path className="line" d={line} />
        {n > 0 && <circle className="cap" cx={x(n - 1)} cy={y(last.count)} r={3.4} />}
        {data.map((d, i) =>
          i % 3 === 0 || i === n - 1 ? (
            <text key={i} className="chart-axis" x={x(i)} y={H - 4} textAnchor={i === 0 ? "start" : i === n - 1 ? "end" : "middle"}>
              {d.label}
            </text>
          ) : null,
        )}
      </svg>
    </div>
  );
}
