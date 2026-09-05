import { credentials, type SnowCredential } from "@/lib/servicenow/credentials";

/**
 * One authenticated HTTP client per ServiceNow instance (NATIVE_ENGINE_BRIEF
 * Phase 3). Wraps Node's global `fetch`. Holds a cookie jar so a
 * `setCurrentApplication` call's session persists across the writes that
 * follow in the same run. Never logs secrets.
 */

type Json = Record<string, unknown>;

export type SnowErrorKind =
  | "UNAUTHENTICATED"
  | "FORBIDDEN"
  | "CROSS_SCOPE"
  | "SCOPE_RESTRICTION"
  | "NOT_FOUND"
  | "RATE_LIMITED"
  | "SERVER_ERROR"
  | "NETWORK"
  | "UNKNOWN";

export interface SnowErrorInfo {
  kind: SnowErrorKind;
  status: number;
  message: string;
  hint?: string;
}

export interface SnowResponse<T = unknown> {
  ok: boolean;
  status: number;
  body: T;
  /** Populated when `!ok` — a typed classification the agent and reviewer can read. */
  error?: SnowErrorInfo;
}

export class SnowError extends Error {
  constructor(public readonly info: SnowErrorInfo) {
    super(`${info.kind} (${info.status}): ${info.message}${info.hint ? ` — ${info.hint}` : ""}`);
    this.name = "SnowError";
  }
}

export interface RequestLogEntry {
  method: string;
  path: string;
  query?: Record<string, string>;
  body?: unknown;
  status: number;
  sysId?: string;
  ms: number;
}

const SECRET_KEY_RE = /^(authorization|cookie|client_secret|password|access_token|refresh_token)$/i;

/** Deep-copy `v` with secret-looking keys replaced. Safe for logs / artifacts. */
export function redact(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(redact);
  if (v && typeof v === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, val] of Object.entries(v as Json)) {
      out[k] = SECRET_KEY_RE.test(k) ? "«redacted»" : redact(val);
    }
    return out;
  }
  return v;
}

function extractMessage(body: unknown): string {
  if (body && typeof body === "object") {
    const e = (body as Json).error;
    if (e && typeof e === "object") {
      const { message, detail } = e as Json;
      return [message, detail].filter(Boolean).join(" — ") || JSON.stringify(e);
    }
    if (typeof (body as Json).message === "string") return (body as Json).message as string;
  }
  return typeof body === "string" ? body.slice(0, 500) : "";
}

function classify(status: number, body: unknown): SnowErrorInfo {
  const message = extractMessage(body) || `HTTP ${status}`;
  const lc = message.toLowerCase();
  if (status === 401) {
    return {
      kind: "UNAUTHENTICATED",
      status,
      message,
      hint: "credentials/token rejected — for OAuth client-credentials, confirm the OAuth Application User is set and active",
    };
  }
  if (status === 403) {
    if (lc.includes("cross-scope access policy")) {
      return { kind: "CROSS_SCOPE", status, message, hint: "target scope's cross-scope access policy blocks this caller" };
    }
    if (lc.includes("unrestricted access to unscoped") || lc.includes("unscoped apis")) {
      return {
        kind: "SCOPE_RESTRICTION",
        status,
        message,
        hint: "Application Registry Scope Restriction is 'Securely Scoped' — set it to allow unscoped access (Zurich+)",
      };
    }
    return { kind: "FORBIDDEN", status, message, hint: "ACL or Application Access restriction on the table/record" };
  }
  if (status === 404) return { kind: "NOT_FOUND", status, message };
  if (status === 429) return { kind: "RATE_LIMITED", status, message };
  if (status >= 500) return { kind: "SERVER_ERROR", status, message };
  return { kind: "UNKNOWN", status, message };
}

export interface RequestOpts {
  query?: Record<string, string | number | boolean | undefined>;
  body?: unknown;
  headers?: Record<string, string>;
  /** default: true for GET */
  retryOn5xx?: boolean;
  timeoutMs?: number;
}

export class SnowClient {
  private readonly baseUrl: string;
  private readonly cred: SnowCredential;
  private cookies = new Map<string, string>();
  private token?: { value: string; expiresAt: number };
  /** Every request this client made — redacted bodies. For the DEPLOY_LOG artifact. */
  readonly requestLog: RequestLogEntry[] = [];

  constructor(opts: { baseUrl: string; credential: SnowCredential }) {
    this.baseUrl = opts.baseUrl.replace(/\/+$/, "");
    this.cred = opts.credential;
  }

  static forInstance(
    instance: { url: string; credentialRef: string; readOnlyCredentialRef?: string | null },
    opts: { readOnly?: boolean } = {},
  ): SnowClient {
    const ref =
      opts.readOnly && instance.readOnlyCredentialRef ? instance.readOnlyCredentialRef : instance.credentialRef;
    return new SnowClient({ baseUrl: instance.url, credential: credentials.resolve(ref) });
  }

  // --- auth --------------------------------------------------------------
  private async authHeader(forceRefresh = false): Promise<string> {
    if (this.cred.mode === "basic") {
      return "Basic " + Buffer.from(`${this.cred.username}:${this.cred.password}`).toString("base64");
    }
    const now = Date.now();
    if (!forceRefresh && this.token && this.token.expiresAt - 30_000 > now) {
      return `Bearer ${this.token.value}`;
    }
    const tokenUrl = this.cred.tokenUrl || `${this.baseUrl}/oauth_token.do`;
    const form = new URLSearchParams({
      grant_type: "client_credentials",
      client_id: this.cred.clientId,
      client_secret: this.cred.clientSecret,
    });
    const res = await fetch(tokenUrl, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
      body: form,
    });
    const body = (await res.json().catch(() => ({}))) as Json;
    if (!res.ok || !body.access_token) {
      throw new SnowError({
        kind: res.status === 401 ? "UNAUTHENTICATED" : "UNKNOWN",
        status: res.status,
        message: extractMessage(body) || "oauth_token.do did not return an access_token",
        hint: "check client_id/secret, the inbound client-credentials grant property, and the OAuth Application User",
      });
    }
    const ttl = Number(body.expires_in ?? 1800) * 1000;
    this.token = { value: String(body.access_token), expiresAt: now + ttl };
    return `Bearer ${this.token.value}`;
  }

  // --- cookie jar ------------------------------------------------------------
  private storeCookies(res: Response): void {
    const set = typeof res.headers.getSetCookie === "function" ? res.headers.getSetCookie() : [];
    for (const c of set) {
      const [pair] = c.split(";");
      const eq = pair.indexOf("=");
      if (eq > 0) this.cookies.set(pair.slice(0, eq).trim(), pair.slice(eq + 1).trim());
    }
  }
  private cookieHeader(): string | undefined {
    if (this.cookies.size === 0) return undefined;
    return [...this.cookies].map(([k, v]) => `${k}=${v}`).join("; ");
  }

  // --- core request -------------------------------------------------------
  private async request<T>(method: string, path: string, opts: RequestOpts = {}): Promise<SnowResponse<T>> {
    const url = new URL(path.startsWith("http") ? path : `${this.baseUrl}${path.startsWith("/") ? "" : "/"}${path}`);
    for (const [k, v] of Object.entries(opts.query ?? {})) {
      if (v !== undefined) url.searchParams.set(k, String(v));
    }
    const retry = opts.retryOn5xx ?? method === "GET";
    const started = Date.now();
    let attempt = 0;
    let last: SnowResponse<T>;

    for (;;) {
      attempt++;
      let refreshedAuth = false;
      const doFetch = async (): Promise<SnowResponse<T>> => {
        const headers: Record<string, string> = {
          Accept: "application/json",
          Authorization: await this.authHeader(refreshedAuth),
          ...(opts.body !== undefined ? { "Content-Type": "application/json" } : {}),
          ...opts.headers,
        };
        const cookie = this.cookieHeader();
        if (cookie) headers.Cookie = cookie;

        const ac = new AbortController();
        const timer = setTimeout(() => ac.abort(), opts.timeoutMs ?? 45_000);
        let res: Response;
        try {
          res = await fetch(url, {
            method,
            headers,
            body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
            signal: ac.signal,
          });
        } catch (err) {
          clearTimeout(timer);
          return {
            ok: false,
            status: 0,
            body: undefined as T,
            error: { kind: "NETWORK", status: 0, message: err instanceof Error ? err.message : String(err) },
          };
        }
        clearTimeout(timer);
        this.storeCookies(res);
        const text = await res.text();
        let parsed: unknown;
        try {
          parsed = text ? JSON.parse(text) : {};
        } catch {
          parsed = text;
        }
        const out: SnowResponse<T> = { ok: res.ok, status: res.status, body: parsed as T };
        if (!res.ok) out.error = classify(res.status, parsed);
        return out;
      };

      last = await doFetch();

      // OAuth: one forced token refresh + retry on 401
      if (last.status === 401 && this.cred.mode === "oauth_cc" && !refreshedAuth) {
        refreshedAuth = true;
        last = await doFetch();
      }

      if (retry && last.status >= 500 && attempt <= 3) {
        await new Promise((r) => setTimeout(r, 300 * attempt));
        continue;
      }
      break;
    }

    const sysId =
      last.ok && last.body && typeof last.body === "object"
        ? ((last.body as Json).result && typeof (last.body as Json).result === "object"
            ? ((last.body as Json).result as Json).sys_id
            : undefined)
        : undefined;
    this.requestLog.push({
      method,
      path: url.pathname,
      query: opts.query
        ? Object.fromEntries(Object.entries(opts.query).filter(([, v]) => v !== undefined).map(([k, v]) => [k, String(v)]))
        : undefined,
      body: opts.body !== undefined ? redact(opts.body) : undefined,
      status: last.status,
      sysId: typeof sysId === "string" ? sysId : undefined,
      ms: Date.now() - started,
    });
    return last;
  }

  get<T = unknown>(path: string, opts?: RequestOpts) {
    return this.request<T>("GET", path, opts);
  }
  post<T = unknown>(path: string, opts?: RequestOpts) {
    return this.request<T>("POST", path, opts);
  }
  patch<T = unknown>(path: string, opts?: RequestOpts) {
    return this.request<T>("PATCH", path, opts);
  }
  put<T = unknown>(path: string, opts?: RequestOpts) {
    return this.request<T>("PUT", path, opts);
  }
  del<T = unknown>(path: string, opts?: RequestOpts) {
    return this.request<T>("DELETE", path, opts);
  }

  /** Throw a `SnowError` if the response failed. */
  expectOk<T>(res: SnowResponse<T>): SnowResponse<T> {
    if (!res.ok) throw new SnowError(res.error ?? classify(res.status, res.body));
    return res;
  }

  // --- Table API convenience -------------------------------------------------
  readonly table = {
    list: async <T = Json>(
      name: string,
      q: { query?: string; fields?: string; limit?: number } = {},
    ): Promise<T[]> => {
      const res = await this.get<{ result: T[] }>(`/api/now/table/${name}`, {
        query: {
          sysparm_query: q.query,
          sysparm_fields: q.fields,
          sysparm_limit: q.limit ?? 100,
          sysparm_exclude_reference_link: true,
        },
      });
      return this.expectOk(res).body.result ?? [];
    },
    getOne: async <T = Json>(
      name: string,
      q: { query?: string; sysId?: string; fields?: string } = {},
    ): Promise<T | null> => {
      if (q.sysId) {
        const res = await this.get<{ result: T }>(`/api/now/table/${name}/${q.sysId}`, {
          query: { sysparm_fields: q.fields, sysparm_exclude_reference_link: true },
        });
        if (res.status === 404) return null;
        return this.expectOk(res).body.result ?? null;
      }
      const rows = await this.table.list<T>(name, { query: q.query, fields: q.fields, limit: 1 });
      return rows[0] ?? null;
    },
    insert: async <T = Json>(name: string, fields: Json): Promise<T> => {
      const res = await this.post<{ result: T }>(`/api/now/table/${name}`, {
        query: { sysparm_exclude_reference_link: true },
        body: fields,
      });
      return this.expectOk(res).body.result;
    },
    update: async <T = Json>(name: string, sysId: string, fields: Json): Promise<T> => {
      const res = await this.patch<{ result: T }>(`/api/now/table/${name}/${sysId}`, {
        query: { sysparm_exclude_reference_link: true },
        body: fields,
      });
      return this.expectOk(res).body.result;
    },
    del: async (name: string, sysId: string): Promise<void> => {
      const res = await this.del(`/api/now/table/${name}/${sysId}`);
      if (res.status !== 404) this.expectOk(res);
    },
  };
}
