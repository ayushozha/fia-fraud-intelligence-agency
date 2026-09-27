import type { Ctx, Route } from "../context.ts";

type Row = { id: string; invoice_ids: string; amount_cents: number; status: string; version: number; updated_at: string };

export function register(ctx: Ctx): Route[] {
  return [
    {
      method: "GET",
      path: "/api/payments",
      handler: (_req, res) => {
        const rows = ctx.store.db.prepare("SELECT id, invoice_ids, amount_cents, status, version, updated_at FROM payment_queue ORDER BY updated_at DESC").all() as Row[];
        ctx.send(res, 200, { payments: rows.map((r) => ({ id: r.id, invoiceIds: JSON.parse(r.invoice_ids) as string[], amountCents: Number(r.amount_cents), status: r.status, version: Number(r.version), updatedAt: r.updated_at })) });
      },
    },
  ];
}
