/**
 * ServiceNow release families in chronological order (NATIVE_ENGINE_BRIEF
 * Phase 3, §3.4). Config-driven so a new release is a one-line change. The
 * probe reads `glide.buildname` from `sys_properties` and matches it here.
 */

export const RELEASE_FAMILIES = [
  "quebec",
  "rome",
  "san diego",
  "tokyo",
  "utah",
  "vancouver",
  "washington dc",
  "xanadu",
  "yokohama",
  "zurich",
  // The SDK gained global-app support in this release. Confirm the exact
  // `glide.buildname` string from the probe and correct the label if needed.
  "australia",
] as const;

export type ReleaseFamily = (typeof RELEASE_FAMILIES)[number];

/** Minimum release for SDK/Fluent *global* apps (the Fluent tier only). */
export const FLUENT_GLOBAL_APPS_MIN: ReleaseFamily = "australia";

/** Minimum release where the Application Registry "Scope Restriction" applies. */
export const SCOPE_RESTRICTION_MIN: ReleaseFamily = "zurich";

function normalize(s: string): string {
  return s.toLowerCase().replace(/[_\-\s]+/g, " ").trim();
}

/**
 * Index of a release in the ordered list, or -1 if unknown. Tolerates raw
 * build strings like `glide-australia-02-11-2026__patch3-…` and
 * `Washington DC 12-19-2024`.
 */
export function releaseIndex(name?: string | null): number {
  if (!name) return -1;
  const n = normalize(name);
  const exact = RELEASE_FAMILIES.indexOf(n as ReleaseFamily);
  if (exact >= 0) return exact;
  // longest family name first, so "washington dc" wins over a stray "dc"
  const byLen = [...RELEASE_FAMILIES].sort((a, b) => b.length - a.length);
  const hit = byLen.find((f) => n.includes(f));
  return hit ? RELEASE_FAMILIES.indexOf(hit) : -1;
}

/** Best-effort family name from a raw `glide.buildname` / `glide.war` string. */
export function familyOf(raw: string): ReleaseFamily | "unknown" {
  const idx = releaseIndex(raw);
  return idx >= 0 ? RELEASE_FAMILIES[idx] : "unknown";
}

export function atLeast(name: string | null | undefined, min: ReleaseFamily): boolean {
  const a = releaseIndex(name);
  const b = releaseIndex(min);
  return a >= 0 && b >= 0 && a >= b;
}
