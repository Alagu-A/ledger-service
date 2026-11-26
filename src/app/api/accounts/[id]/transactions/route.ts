import { NextResponse } from "next/server";
import { fail, isUuid } from "@/lib/http";
import { applyTransaction, LedgerError } from "@/lib/ledger";

const MAX_AMOUNT_CENTS = 100_000_000;

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  if (!isUuid(id)) return fail("Invalid account id");

  const key = req.headers.get("idempotency-key");
  if (!key || key.length > 128) {
    return fail("Idempotency-Key header is required (max 128 characters)");
  }

  let payload: { type?: unknown; amountCents?: unknown } | null;
  try {
    payload = await req.json();
  } catch {
    return fail("Body must be valid JSON");
  }

  const type = payload?.type;
  const amountCents = payload?.amountCents;

  if (type !== "credit" && type !== "debit") {
    return fail("type must be 'credit' or 'debit'");
  }
  if (
    typeof amountCents !== "number" ||
    !Number.isInteger(amountCents) ||
    amountCents <= 0 ||
    amountCents > MAX_AMOUNT_CENTS
  ) {
    return fail("amountCents must be a positive integer");
  }

  try {
    const result = await applyTransaction({
      accountId: id,
      type,
      amountCents,
      idempotencyKey: key,
    });
    return NextResponse.json(result.body, {
      status: result.status,
      headers: result.replayed ? { "Idempotent-Replayed": "true" } : {},
    });
  } catch (err) {
    if (err instanceof LedgerError) {
      return NextResponse.json(
        { error: err.message, code: err.code },
        { status: err.status },
      );
    }
    console.error(err);
    return fail("Internal error", 500);
  }
}
