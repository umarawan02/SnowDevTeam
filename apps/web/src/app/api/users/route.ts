import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { requireUser, AuthError } from "@/lib/auth/current-user";
import { hashPassword, generateTempPassword } from "@/lib/auth/password";
import { USER_ROLES } from "@/lib/auth/rbac";

export const dynamic = "force-dynamic";

function handleAuth(e: unknown) {
  if (e instanceof AuthError) {
    return NextResponse.json({ error: e.message }, { status: e.kind === "forbidden" ? 403 : 401 });
  }
  throw e;
}

export async function GET() {
  try {
    await requireUser(["ADMIN"]);
  } catch (e) {
    return handleAuth(e);
  }
  const users = await prisma.user.findMany({
    orderBy: [{ active: "desc" }, { createdAt: "asc" }],
    select: {
      id: true, email: true, name: true, role: true, active: true,
      lastLoginAt: true, createdAt: true,
      _count: { select: { createdTickets: true, reviewedTickets: true } },
    },
  });
  return NextResponse.json({ users });
}

const CreateBody = z.object({
  email: z.string().trim().toLowerCase().email(),
  name: z.string().trim().max(120).optional(),
  role: z.enum(USER_ROLES),
});

export async function POST(req: Request) {
  try {
    await requireUser(["ADMIN"]);
  } catch (e) {
    return handleAuth(e);
  }

  let json: unknown;
  try {
    json = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }
  const parsed = CreateBody.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid body", issues: parsed.error.flatten() }, { status: 400 });
  }

  const existing = await prisma.user.findUnique({ where: { email: parsed.data.email } });
  if (existing) {
    return NextResponse.json({ error: "A user with that email already exists." }, { status: 409 });
  }

  const tempPassword = generateTempPassword();
  const user = await prisma.user.create({
    data: {
      email: parsed.data.email,
      name: parsed.data.name || null,
      role: parsed.data.role,
      passwordHash: await hashPassword(tempPassword),
    },
    select: { id: true, email: true, name: true, role: true, active: true },
  });

  // The temp password is returned exactly once — the admin passes it to the user.
  return NextResponse.json({ user, tempPassword }, { status: 201 });
}
