import { cache } from "react";
import { cookies } from "next/headers";
import { prisma } from "@/lib/db";
import { SESSION_COOKIE, verifySession } from "@/lib/auth/session";
import type { UserRole } from "@/lib/auth/rbac";

export interface CurrentUser {
  id: string;
  email: string;
  name: string | null;
  role: string;
  image: string | null;
}

/**
 * The signed-in user for the current request, or null. Reads the session
 * cookie, verifies the JWT, then confirms the user still exists and is active.
 * `cache()`-wrapped so multiple calls in one render hit the DB once.
 */
export const getCurrentUser = cache(async (): Promise<CurrentUser | null> => {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (!token) return null;

  const payload = await verifySession(token);
  if (!payload) return null;

  const user = await prisma.user.findUnique({
    where: { id: payload.sub },
    select: { id: true, email: true, name: true, role: true, image: true, active: true },
  });
  if (!user || !user.active) return null;

  return { id: user.id, email: user.email, name: user.name, role: user.role, image: user.image };
});

export class AuthError extends Error {
  constructor(
    public readonly kind: "unauthenticated" | "forbidden",
    message?: string,
  ) {
    super(message ?? kind);
  }
}

/**
 * Assert a signed-in user, optionally with one of `roles`. Throws AuthError —
 * route handlers map it to 401/403; server components can catch and redirect.
 */
export async function requireUser(roles?: UserRole[]): Promise<CurrentUser> {
  const user = await getCurrentUser();
  if (!user) throw new AuthError("unauthenticated");
  if (roles && !roles.includes(user.role as UserRole)) {
    throw new AuthError("forbidden", `requires one of: ${roles.join(", ")}`);
  }
  return user;
}
