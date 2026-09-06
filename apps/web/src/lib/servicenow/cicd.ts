import { SnowClient, SnowError } from "@/lib/servicenow/client";

/**
 * Shared helpers for the asynchronous `sn_cicd` API (NATIVE_ENGINE_BRIEF §5.3).
 * Every `sn_cicd` call returns `links.progress.url`; HTTP 200 is **not**
 * success — the work is done only when `GET /api/sn_cicd/progress/{id}` reports
 * status 2. Status 3/4 is a failure regardless of HTTP code.
 */

export interface CicdProgress {
  status: string; // "0" pending | "1" running | "2" successful | "3" failed | "4" cancelled
  status_label?: string;
  status_message?: string;
  status_detail?: string;
  percent_complete?: string | number;
  error?: string;
  /** Present on some completions — the created/updated artefact ids. */
  [k: string]: unknown;
}

export class CicdError extends Error {
  constructor(
    message: string,
    public readonly progress?: CicdProgress,
  ) {
    super(message);
    this.name = "CicdError";
  }
}

/** `links.progress.url` may be absolute — reduce to the instance-relative path. */
export function progressPath(urlOrPath: string): string {
  try {
    return new URL(urlOrPath).pathname;
  } catch {
    return urlOrPath.startsWith("/") ? urlOrPath : `/${urlOrPath}`;
  }
}

export interface CicdKickoff {
  result?: {
    links?: { progress?: { id?: string; url?: string } };
    [k: string]: unknown;
  };
}

/** Extract `links.progress.url` from a kickoff response, or throw. */
export function progressUrlOf(body: CicdKickoff): string {
  const url = body.result?.links?.progress?.url;
  if (!url) throw new CicdError(`sn_cicd response carried no links.progress.url: ${JSON.stringify(body).slice(0, 400)}`);
  return url;
}

/**
 * Poll `GET /api/sn_cicd/progress/{id}` until status is terminal. Returns the
 * final progress payload on success (status 2); throws `CicdError` on 3/4 or
 * timeout.
 */
export async function pollProgress(
  client: SnowClient,
  progressUrlOrPath: string,
  opts: { timeoutMs?: number; intervalMs?: number } = {},
): Promise<CicdProgress> {
  const timeoutMs = opts.timeoutMs ?? 10 * 60_000;
  const intervalMs = opts.intervalMs ?? 3_000;
  const started = Date.now();
  const path = progressPath(progressUrlOrPath);

  for (;;) {
    const res = await client.get<{ result?: CicdProgress } & CicdProgress>(path);
    if (!res.ok) throw new SnowError(res.error ?? { kind: "UNKNOWN", status: res.status, message: "progress poll failed" });
    const p = ((res.body as { result?: CicdProgress }).result ?? (res.body as CicdProgress)) || ({} as CicdProgress);
    const status = String(p.status ?? "");

    if (status === "2") return p;
    if (status === "3" || status === "4") {
      throw new CicdError(
        `sn_cicd job ${status === "3" ? "failed" : "cancelled"}: ${p.status_message ?? p.error ?? p.status_detail ?? "(no detail)"}`,
        p,
      );
    }
    if (Date.now() - started > timeoutMs) {
      throw new CicdError(`sn_cicd job did not finish within ${Math.round(timeoutMs / 1000)}s (last status ${status || "?"})`, p);
    }
    await new Promise((r) => setTimeout(r, intervalMs));
  }
}

/** POST an sn_cicd endpoint and poll its progress to completion. */
export async function cicdCall(
  client: SnowClient,
  path: string,
  opts: { query?: Record<string, string>; body?: unknown; timeoutMs?: number } = {},
): Promise<CicdProgress> {
  const res = await client.post<CicdKickoff & Record<string, unknown>>(path, { query: opts.query, body: opts.body });
  // A synchronous rejection comes back as HTTP 4xx with a status "3" payload —
  // surface its message, not a bare "HTTP 400".
  const immediate = ((res.body as { result?: CicdProgress })?.result ?? {}) as CicdProgress;
  if (!res.ok) {
    const detail = immediate.error || immediate.status_message || immediate.status_detail;
    if (detail) throw new CicdError(`${path}: ${detail}`, immediate);
    throw new SnowError(res.error ?? { kind: "UNKNOWN", status: res.status, message: `${path} failed` });
  }
  return pollProgress(client, progressUrlOf(res.body as CicdKickoff), { timeoutMs: opts.timeoutMs });
}
