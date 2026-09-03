/**
 * Parser for the SDK-managed `src/fluent/generated/keys.ts`. Every metadata
 * record the Fluent sources declare gets an entry in the `explicit:` block:
 *
 *   'company-tshirt-request': {
 *       table: 'sc_cat_item'
 *       id: '620491dc1a2343508d724eb18ffaeb6b'
 *   }
 *
 * The build gate / deploy use this to know exactly which sys_ids a build
 * created, so verification can query those records directly.
 */

export interface KeyRecord {
  /** The Now.ID key, e.g. "company-tshirt-request". */
  key: string;
  /** Target table, e.g. "sc_cat_item". */
  table: string;
  /** sys_id on the instance. */
  id: string;
}

const ENTRY_RE =
  /(['"]?)([A-Za-z0-9_$-]+)\1\s*:\s*\{\s*table\s*:\s*['"]([^'"]+)['"]\s*id\s*:\s*['"]([0-9a-f]{32})['"]/g;

/** Every `{ key, table, id }` in a keys.ts source string. */
export function parseKeys(src: string | null | undefined): KeyRecord[] {
  if (!src) return [];
  const out: KeyRecord[] = [];
  for (const m of src.matchAll(ENTRY_RE)) {
    out.push({ key: m[2], table: m[3], id: m[4] });
  }
  return out;
}

/** Records present in `after` whose sys_id was not in `before` — this build's net-new. */
export function keysAdded(before: string | null | undefined, after: string | null | undefined): KeyRecord[] {
  const had = new Set(parseKeys(before).map((r) => r.id));
  return parseKeys(after).filter((r) => !had.has(r.id));
}
