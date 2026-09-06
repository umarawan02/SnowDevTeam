import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { requireUser, AuthError } from "@/lib/auth/current-user";

export const dynamic = "force-dynamic";

const PatchBody = z.object({
  name: z.string().trim().min(2).max(80).optional(),
  url: z.string().trim().url().optional(),
  env: z.enum(["dev", "test", "prod"]).optional(),
  authMode: z.enum(["oauth_cc", "basic"]).optional(),
  credentialRef: z.string().trim().min(1).max(120).optional(),
  readOnlyCredentialRef: z.string().trim().max(120).nullable().optional(),
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
  if (!(await prisma.instance.findUnique({ where: { id } }))) return NextResponse.json({ error: "not found" }, { status: 404 });

  const data: Record<string, unknown> = { ...parsed.data };
  if (typeof data.url === "string") data.url = data.url.replace(/\/+$/, "");
  if (data.readOnlyCredentialRef === "") data.readOnlyCredentialRef = null;

  const instance = await prisma.instance.update({ where: { id }, data });
  return NextResponse.json({ instance });
}
