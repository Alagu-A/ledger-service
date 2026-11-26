import { NextResponse } from "next/server";
import { fail, isUuid } from "@/lib/http";
import { getAccount } from "@/lib/ledger";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  if (!isUuid(id)) return fail("Invalid account id");

  const result = await getAccount(id);
  if (!result) return fail("Account not found", 404);

  return NextResponse.json(result);
}
