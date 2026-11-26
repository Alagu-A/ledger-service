import { createHash } from "crypto";
import type { PoolClient } from "pg";
import { pool } from "./db";

export type TxType = "credit" | "debit";

export class LedgerError extends Error {
  constructor(
    public code: string,
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

export type TxResult = { status: number; body: unknown; replayed: boolean };

async function withTransaction<T>(
  work: (client: PoolClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await work(client);
    await client.query("COMMIT");
    return result;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

export async function createAccount(name: string) {
  const { rows } = await pool.query(
    `INSERT INTO accounts (name) VALUES ($1) RETURNING id, name, balance_cents`,
    [name],
  );
  return {
    id: rows[0].id as string,
    name: rows[0].name as string,
    balanceCents: Number(rows[0].balance_cents),
  };
}

export async function getAccount(id: string) {
  const account = await pool.query(
    `SELECT id, name, balance_cents FROM accounts WHERE id = $1`,
    [id],
  );
  if (account.rowCount === 0) return null;

  const entries = await pool.query(
    `SELECT id, type, amount_cents, balance_after_cents, created_at
       FROM ledger_entries
      WHERE account_id = $1
      ORDER BY id DESC
      LIMIT 20`,
    [id],
  );

  return {
    account: {
      id: account.rows[0].id as string,
      name: account.rows[0].name as string,
      balanceCents: Number(account.rows[0].balance_cents),
    },
    entries: entries.rows.map((r) => ({
      id: Number(r.id),
      type: r.type as TxType,
      amountCents: Number(r.amount_cents),
      balanceAfterCents: Number(r.balance_after_cents),
      createdAt: r.created_at as string,
    })),
  };
}

export async function applyTransaction(input: {
  accountId: string;
  type: TxType;
  amountCents: number;
  idempotencyKey: string;
}): Promise<TxResult> {
  const { accountId, type, amountCents, idempotencyKey } = input;

  const requestHash = createHash("sha256")
    .update(`${accountId}:${type}:${amountCents}`)
    .digest("hex");

  return withTransaction(async (client) => {
    // Claim the key. A concurrent request with the same key blocks here
    // until we commit or roll back.
    const claimed = await client.query(
      `INSERT INTO idempotency_keys (key, request_hash)
       VALUES ($1, $2)
       ON CONFLICT (key) DO NOTHING
       RETURNING key`,
      [idempotencyKey, requestHash],
    );

    if (claimed.rowCount === 0) {
      const { rows } = await client.query(
        `SELECT request_hash, response_status, response_body
           FROM idempotency_keys WHERE key = $1`,
        [idempotencyKey],
      );
      if (rows[0].request_hash !== requestHash) {
        throw new LedgerError(
          "KEY_REUSED",
          422,
          "Idempotency key was already used with a different request",
        );
      }
      return {
        status: rows[0].response_status as number,
        body: rows[0].response_body,
        replayed: true,
      };
    }

    const locked = await client.query(
      `SELECT balance_cents FROM accounts WHERE id = $1 FOR UPDATE`,
      [accountId],
    );
    if (locked.rowCount === 0) {
      throw new LedgerError("NOT_FOUND", 404, "Account not found");
    }

    const current = Number(locked.rows[0].balance_cents);
    const next =
      type === "credit" ? current + amountCents : current - amountCents;
    if (next < 0) {
      throw new LedgerError("INSUFFICIENT_FUNDS", 409, "Insufficient funds");
    }

    await client.query(`UPDATE accounts SET balance_cents = $1 WHERE id = $2`, [
      next,
      accountId,
    ]);

    const entry = await client.query(
      `INSERT INTO ledger_entries
         (account_id, type, amount_cents, balance_after_cents, idempotency_key)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id`,
      [accountId, type, amountCents, next, idempotencyKey],
    );

    const body = {
      entryId: Number(entry.rows[0].id),
      accountId,
      type,
      amountCents,
      balanceCents: next,
    };

    await client.query(
      `UPDATE idempotency_keys
          SET response_status = 201, response_body = $2
        WHERE key = $1`,
      [idempotencyKey, JSON.stringify(body)],
    );

    return { status: 201, body, replayed: false };
  });
}
