"use client";

import { useState } from "react";

type Account = { id: string; name: string; balanceCents: number };
type Entry = {
  id: number;
  type: "credit" | "debit";
  amountCents: number;
  balanceAfterCents: number;
  createdAt: string;
};

const inr = (cents: number) =>
  (cents / 100).toLocaleString("en-IN", { style: "currency", currency: "INR" });

export default function Home() {
  const [account, setAccount] = useState<Account | null>(null);
  const [entries, setEntries] = useState<Entry[]>([]);
  const [name, setName] = useState("");
  const [amount, setAmount] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function refresh(id: string) {
    const res = await fetch(`/api/accounts/${id}`);
    const data = await res.json();
    setAccount(data.account);
    setEntries(data.entries);
  }

  async function openAccount(e: React.FormEvent) {
    e.preventDefault();
    const res = await fetch("/api/accounts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    });
    const data = await res.json();
    if (!res.ok) return setError(data.error);
    setError("");
    setName("");
    await refresh(data.id);
  }

  async function post(type: "credit" | "debit") {
    if (!account) return;
    const amountCents = Math.round(Number(amount) * 100);
    if (!Number.isFinite(amountCents) || amountCents <= 0) {
      return setError("Enter an amount greater than zero");
    }

    setBusy(true);
    try {
      const res = await fetch(`/api/accounts/${account.id}/transactions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": crypto.randomUUID(),
        },
        body: JSON.stringify({ type, amountCents }),
      });
      const data = await res.json();
      if (!res.ok) return setError(data.error);
      setError("");
      setAmount("");
      await refresh(account.id);
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="page">
      <h1>Ledger</h1>
      <p className="lede">Append-only account ledger with idempotent writes.</p>

      {!account ? (
        <form className="row" onSubmit={openAccount}>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Account name"
            maxLength={80}
          />
          <button type="submit">Open account</button>
        </form>
      ) : (
        <>
          <div className="meta">{account.name}</div>
          <div className="balance">{inr(account.balanceCents)}</div>
          <div className="meta">ID {account.id}</div>

          <div className="row spaced">
            <input
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="Amount (INR)"
              inputMode="decimal"
            />
            <button disabled={busy} onClick={() => post("credit")}>
              Credit
            </button>
            <button
              className="secondary"
              disabled={busy}
              onClick={() => post("debit")}
            >
              Debit
            </button>
          </div>

          <table>
            <thead>
              <tr>
                <th>Type</th>
                <th className="num">Amount</th>
                <th className="num">Balance after</th>
                <th className="num">Time</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((e) => (
                <tr key={e.id}>
                  <td>{e.type}</td>
                  <td className="num">{inr(e.amountCents)}</td>
                  <td className="num">{inr(e.balanceAfterCents)}</td>
                  <td className="num">
                    {new Date(e.createdAt).toLocaleTimeString("en-IN")}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}

      {error && <p className="error">{error}</p>}
    </main>
  );
}
