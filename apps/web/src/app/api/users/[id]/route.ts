import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { requireUser, AuthError } from "@/lib/auth/current-user";
import { hashPassword, generateTempPassword } from "@/lib/auth/password";
import { USER_ROLES } from "@/lib/auth/rbac";

export const dynamic = "force-dynamic";

const PatchBody = z.object({
  name: z.string().trim().max(120).nullable().optional(),
  role: z.enum(USER_ROLES).optional(),
  active: z.boolean().optional(),
  resetPassword: z.literal(true).optional(),
});

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  let admin;
  try {
    admin = await requireUser(["ADMIN"]);
  } catch (e) {
    if (e instanceof AuthError) {
      return NextResponse.json({ error: e.message }, { status: e.kind === "forbidden" ? 403 : 401 });
    }
    throw e;
  }

  const { id } = await params;
  let json: unknown;
  try {
    json = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }
  const parsed = PatchBody.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid body", issues: parsed.error.flatten() }, { status: 400 });
  }

  const target = await prisma.user.findUnique({ where: { id } });
  if (!target) return NextResponse.json({ error: "not found" }, { status: 404 });

  // Guard against locking yourself out or demoting the last admin.
  if (target.id === admin.id && (parsed.data.active === false || (parsed.data.role && parsed.data.role !== "ADMIN"))) {
    return NextResponse.json({ error: "You cannot demote or deactivate your own account." }, { status: 409 });
  }
  if (target.role === "ADMIN" && parsed.data.role && parsed.data.role !== "ADMIN") {
    const admins = await prisma.user.count({ where: { role: "ADMIN", active: true } });
    if (admins <= 1) {
      return NextResponse.json({ error: "There must be at least one active admin." }, { status: 409 });
    }
  }

  const data: Record<string, unknown> = {};
  if (parsed.data.name !== undefined) data.name = parsed.data.name;
  if (parsed.data.role !== undefined) data.role = parsed.data.role;
  if (parsed.data.active !== undefined) data.active = parsed.data.active;

  let tempPassword: string | undefined;
  if (parsed.data.resetPassword) {
    tempPassword = generateTempPassword();
    data.passwordHash = await hashPassword(tempPassword);
  }

  const user = await prisma.user.update({
    where: { id },
    data,
    select: { id: true, email: true, name: true, role: true, active: true },
  });
  return NextResponse.json({ user, ...(tempPassword ? { tempPassword } : {}) });
}
