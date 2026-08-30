import { config } from "@/lib/config";

/** Short label for the target ServiceNow instance, e.g. "dev424712". Server-only. */
export function instanceLabel(): string {
  const url = config.SN_INSTANCE_URL;
  if (!url) return "the PDI";
  try {
    return new URL(url).hostname.split(".")[0];
  } catch {
    return url;
  }
}
