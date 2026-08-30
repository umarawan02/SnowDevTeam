import { NextResponse } from "next/server";
import { getPersonas } from "@/lib/agents/personas";

export const dynamic = "force-dynamic";

export async function GET() {
  const personas = await getPersonas();
  return NextResponse.json({ personas });
}
