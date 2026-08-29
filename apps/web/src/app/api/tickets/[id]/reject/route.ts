import { NextResponse } from "next/server";
import { z } from "zod";
import { rejectTicket } from "@/lib/pipeline/deploy";

export const dynamic = "force-dynamic";

const Body = z.object({ note: z.string().trim().min(1, "a note is required").max(2000) });

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  let json: unknown;
  try {
    json = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }
  const parsed = Body.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "invalid body" }, { status: 400 });
  }

  const result = await rejectTicket(id, parsed.data.note);
  if (!result.ok) {
    const status = result.error?.includes("not found") ? 404 : 409;
    return NextResponse.json({ error: result.error }, { status });
  }
  return NextResponse.json({ status: result.status });
}
