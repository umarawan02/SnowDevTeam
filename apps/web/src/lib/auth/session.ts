import { SignJWT, jwtVerify } from "jose";

// Edge-safe (jose only). AUTH_SECRET lives in apps/web/.env so both the Node
// runtime and middleware (Edge) can read it via process.env.
export const SESSION_COOKIE = "snow_session";
const MAX_AGE_SEC = 60 * 60 * 24 * 7; // 7 days

function secret(): Uint8Array {
  const s = process.env.AUTH_SECRET;
  if (!s || s.length < 16) {
    throw new Error("AUTH_SECRET is missing or too short — set it in apps/web/.env");
  }
  return new TextEncoder().encode(s);
}

export interface SessionPayload {
  sub: string; // user id
  email: string;
  role: string;
  name?: string | null;
}

export async function signSession(p: SessionPayload): Promise<string> {
  return new SignJWT({ email: p.email, role: p.role, name: p.name ?? null })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(p.sub)
    .setIssuedAt()
    .setExpirationTime(`${MAX_AGE_SEC}s`)
    .sign(secret());
}

export async function verifySession(token: string): Promise<SessionPayload | null> {
  try {
    const { payload } = await jwtVerify(token, secret(), { algorithms: ["HS256"] });
    if (!payload.sub || typeof payload.role !== "string") return null;
    return {
      sub: payload.sub,
      email: String(payload.email ?? ""),
      role: payload.role,
      name: (payload.name as string | null | undefined) ?? null,
    };
  } catch {
    return null;
  }
}

export const sessionCookieOptions = {
  httpOnly: true,
  sameSite: "lax" as const,
  secure: process.env.NODE_ENV === "production",
  path: "/",
  maxAge: MAX_AGE_SEC,
};
