import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { requireUser, AuthError } from "@/lib/auth/current-user";

export const dynamic = "force-dynamic";

function handleAuth(e: unknown) {
  if (e instanceof AuthError) return NextResponse.json({ error: e.message }, { status: e.kind === "forbidden" ? 403 : 401 });
  throw e;
}

const Body = z.object({
  customerId: z.string().min(1),
  name: z.string().trim().min(2).max(80),
  url: z.string().trim().url(),
  env: z.enum(["dev", "test", "prod"]).default("dev"),
  authMode: z.enum(["oauth_cc", "basic"]).default("oauth_cc"),
  credentialRef: z.string().trim().min(1).max(120),
  readOnlyCredentialRef: z.string().trim().max(120).optional(),
});

export async function GET() {
  try {
    await requireUser(["ADMIN"]);
  } catch (e) {
    return handleAuth(e);
  }
  const instances = await prisma.instance.findMany({ orderBy: [{ customerId: "asc" }, { env: "asc" }] });
  return NextResponse.json({ instances });
}

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
  const parsed = Body.safeParse(json);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "invalid body" }, { status: 400 });
  if (!(await prisma.customer.findUnique({ where: { id: parsed.data.customerId } })))
    return NextResponse.json({ error: "unknown customer" }, { status: 400 });

  const d = parsed.data;
  const instance = await prisma.instance.create({
    data: {
      customerId: d.customerId,
      name: d.name,
      url: d.url.replace(/\/+$/, ""),
      env: d.env,
      authMode: d.authMode,
      credentialRef: d.credentialRef,
      readOnlyCredentialRef: d.readOnlyCredentialRef || null,
    },
  });
  return NextResponse.json({ instance }, { status: 201 });
}
