import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { requireUser, AuthError } from "@/lib/auth/current-user";
import { listCustomersForAdmin, slugFor } from "@/lib/admin/infra";

export const dynamic = "force-dynamic";

function handleAuth(e: unknown) {
  if (e instanceof AuthError) return NextResponse.json({ error: e.message }, { status: e.kind === "forbidden" ? 403 : 401 });
  throw e;
}

export async function GET() {
  try {
    await requireUser(["ADMIN"]);
  } catch (e) {
    return handleAuth(e);
  }
  return NextResponse.json({ customers: await listCustomersForAdmin() });
}

const CreateBody = z.object({ name: z.string().trim().min(2).max(120) });

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
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "invalid body" }, { status: 400 });

  const customer = await prisma.customer.create({
    data: { name: parsed.data.name, slug: await slugFor(parsed.data.name) },
  });
  return NextResponse.json({ customer }, { status: 201 });
}
