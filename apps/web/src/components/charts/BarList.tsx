/** Horizontal labelled bars. */
export function BarList({
  items,
  variant = "accent",
}: {
  items: { label: string; value: number; display: string; max?: number }[];
  variant?: "accent" | "violet";
}) {
  const max = Math.max(1, ...items.map((i) => i.max ?? i.value));
  return (
    <div>
      {items.map((it) => {
        const pct = Math.round((it.value / (it.max ?? max)) * 100);
        return (
          <div className="barrow" key={it.label}>
            <span className="lbl" title={it.label}>{it.label}</span>
            <span className="track">
              <span
                className={`val-bar${variant === "violet" ? " v2" : ""}`}
                style={{ width: `${Math.max(2, Math.min(100, pct))}%` }}
              />
            </span>
            <span className="num">{it.display}</span>
          </div>
        );
      })}
    </div>
  );
}
