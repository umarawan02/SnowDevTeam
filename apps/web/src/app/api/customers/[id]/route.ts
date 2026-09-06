import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { requireUser, AuthError } from "@/lib/auth/current-user";

export const dynamic = "force-dynamic";

const PatchBody = z.object({
  name: z.string().trim().min(2).max(120).optional(),
  allowFluentFlows: z.boolean().optional(),
});

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireUser(["ADMIN"]);
  } catch (e) {
    if (e instanceof AuthError) return NextResponse.json({ error: e.message }, { status: e.kind === "forbidden" ? 403 : 401 });
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
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "invalid body" }, { status: 400 });
  if (!(await prisma.customer.findUnique({ where: { id } }))) return NextResponse.json({ error: "not found" }, { status: 404 });

  const customer = await prisma.customer.update({ where: { id }, data: parsed.data });
  return NextResponse.json({ customer });
}
