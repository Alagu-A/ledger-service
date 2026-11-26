import { randomUUID } from "crypto";
import { pool } from "@/lib/db";
import { applyTransaction, createAccount, getAccount } from "@/lib/ledger";

afterAll(() => pool.end());

const credit = (accountId: string, amountCents: number, key = randomUUID()) =>
  applyTransaction({
    accountId,
    type: "credit",
    amountCents,
    idempotencyKey: key,
  });

const debit = (accountId: string, amountCents: number, key = randomUUID()) =>
  applyTransaction({
    accountId,
    type: "debit",
    amountCents,
    idempotencyKey: key,
  });

test("credit then debit updates the balance", async () => {
  const { id } = await createAccount("basic");
  await credit(id, 1000);
  await debit(id, 300);
  expect((await getAccount(id))?.account.balanceCents).toBe(700);
});

test("overdraft is rejected and balance is untouched", async () => {
  const { id } = await createAccount("overdraft");
  await credit(id, 100);
  await expect(debit(id, 500)).rejects.toMatchObject({
    code: "INSUFFICIENT_FUNDS",
  });
  expect((await getAccount(id))?.account.balanceCents).toBe(100);
});

test("retrying with the same key applies the transaction once", async () => {
  const { id } = await createAccount("retry");
  const key = randomUUID();
  const first = await credit(id, 500, key);
  const second = await credit(id, 500, key);

  expect(second.replayed).toBe(true);
  expect(second.body).toEqual(first.body);

  const state = await getAccount(id);
  expect(state?.account.balanceCents).toBe(500);
  expect(state?.entries).toHaveLength(1);
});

test("same key with a different payload is refused", async () => {
  const { id } = await createAccount("reuse");
  const key = randomUUID();
  await credit(id, 500, key);
  await expect(credit(id, 900, key)).rejects.toMatchObject({
    code: "KEY_REUSED",
  });
});

test("concurrent debits never overdraw", async () => {
  const { id } = await createAccount("race");
  await credit(id, 500);

  const results = await Promise.allSettled(
    Array.from({ length: 10 }, () => debit(id, 100)),
  );

  expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(5);
  expect((await getAccount(id))?.account.balanceCents).toBe(0);
});

test("concurrent retries with one key apply once", async () => {
  const { id } = await createAccount("concurrent-retry");
  const key = randomUUID();

  await Promise.all(Array.from({ length: 5 }, () => credit(id, 500, key)));

  const state = await getAccount(id);
  expect(state?.account.balanceCents).toBe(500);
  expect(state?.entries).toHaveLength(1);
});
