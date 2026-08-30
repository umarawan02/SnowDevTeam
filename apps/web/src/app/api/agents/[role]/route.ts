import { NextResponse } from "next/server";
import { z } from "zod";
import { getPersona, updatePersona, isAgentRole } from "@/lib/agents/personas";
import { MODEL_VALUES } from "@/lib/agents/models";
import { requireUser, AuthError } from "@/lib/auth/current-user";

export const dynamic = "force-dynamic";

const ALLOWED_MODELS = MODEL_VALUES;

const PatchBody = z.object({
  name: z.string().trim().min(1).max(60).optional(),
  title: z.string().trim().min(1).max(60).optional(),
  tagline: z.string().trim().min(1).max(160).optional(),
  bio: z.string().trim().min(1).max(1000).optional(),
  voice: z.string().trim().min(1).max(600).optional(),
  accent: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/, "accent must be a #rrggbb hex")
    .optional(),
  model: z.enum(ALLOWED_MODELS as [string, ...string[]]).optional(),
});

export async function GET(_req: Request, { params }: { params: Promise<{ role: string }> }) {
  const { role } = await params;
  const upper = role.toUpperCase();
  if (!isAgentRole(upper)) return NextResponse.json({ error: "unknown role" }, { status: 404 });
  return NextResponse.json({ persona: await getPersona(upper) });
}

export async function PUT(req: Request, { params }: { params: Promise<{ role: string }> }) {
  try {
    await requireUser(["ADMIN"]);
  } catch (e) {
    if (e instanceof AuthError) {
      return NextResponse.json({ error: e.message }, { status: e.kind === "forbidden" ? 403 : 401 });
    }
    throw e;
  }

  const { role } = await params;
  const upper = role.toUpperCase();
  if (!isAgentRole(upper)) return NextResponse.json({ error: "unknown role" }, { status: 404 });

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

  const persona = await updatePersona(upper, parsed.data);
  return NextResponse.json({ persona });
}
