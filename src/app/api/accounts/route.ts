import { NextResponse } from "next/server";
import { fail } from "@/lib/http";
import { createAccount } from "@/lib/ledger";

export async function POST(req: Request) {
  let body: { name?: unknown } | null;
  try {
    body = await req.json();
  } catch {
    return fail("Body must be valid JSON");
  }

  const name = typeof body?.name === "string" ? body.name.trim() : "";
  if (name.length < 1 || name.length > 80) {
    return fail("name must be between 1 and 80 characters");
  }

  return NextResponse.json(await createAccount(name), { status: 201 });
}
