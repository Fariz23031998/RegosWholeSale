import { useState, useEffect } from "react";
import { formatDate } from "@/components/StatusBadge";

export type PaymentFormValues = {
  amount: string;
  currency: string;
  period_months: string;
  notes: string;
  paid_at: string;
};

const DEFAULT_FORM: PaymentFormValues = {
  amount: "",
  currency: "UZS",
  period_months: "1",
  notes: "",
  paid_at: "",
};

export function toDatetimeLocalValue(iso: string) {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

type RecordPaymentModalProps = {
  companyName: string;
  open: boolean;
  loading?: boolean;
  error?: string;
  mode?: "create" | "edit";
  initialValues?: Partial<PaymentFormValues>;
  onClose: () => void;
  onSubmit: (values: PaymentFormValues) => void;
};

export function RecordPaymentModal({
  companyName,
  open,
  loading,
  error,
  mode = "create",
  initialValues,
  onClose,
  onSubmit,
}: RecordPaymentModalProps) {
  const [form, setForm] = useState(DEFAULT_FORM);
  const isEdit = mode === "edit";

  useEffect(() => {
    if (!open) return;
    if (initialValues) {
      setForm({
        amount: initialValues.amount ?? "",
        currency: initialValues.currency ?? "UZS",
        period_months: initialValues.period_months ?? "1",
        notes: initialValues.notes ?? "",
        paid_at: initialValues.paid_at ?? "",
      });
    } else {
      setForm(DEFAULT_FORM);
    }
  }, [open, initialValues]);

  if (!open) return null;

  const resetAndClose = () => {
    setForm(DEFAULT_FORM);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4">
      <div className="w-full max-w-md rounded-xl border border-slate-200 bg-white p-6 shadow-lg">
        <h2 className="text-lg font-semibold text-slate-900">
          {isEdit ? "Edit payment" : "Record payment & activate"}
        </h2>
        <p className="mt-1 text-sm text-slate-500">{companyName}</p>

        <form
          className="mt-4 space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            onSubmit(form);
          }}
        >
          {isEdit && (
            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700" htmlFor="paid_at">
                Paid at
              </label>
              <input
                id="paid_at"
                type="datetime-local"
                required
                className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                value={form.paid_at}
                onChange={(e) => setForm({ ...form, paid_at: e.target.value })}
              />
            </div>
          )}

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700" htmlFor="amount">
                Amount
              </label>
              <input
                id="amount"
                type="number"
                min={0.01}
                step="0.01"
                required
                className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                value={form.amount}
                onChange={(e) => setForm({ ...form, amount: e.target.value })}
              />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700" htmlFor="currency">
                Currency
              </label>
              <input
                id="currency"
                type="text"
                required
                className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm uppercase"
                value={form.currency}
                onChange={(e) => setForm({ ...form, currency: e.target.value.toUpperCase() })}
              />
            </div>
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium text-slate-700" htmlFor="period">
              Subscription period
            </label>
            <select
              id="period"
              className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
              value={form.period_months}
              onChange={(e) => setForm({ ...form, period_months: e.target.value })}
            >
              <option value="1">1 month (30 days)</option>
              <option value="3">3 months (90 days)</option>
              <option value="6">6 months (180 days)</option>
              <option value="12">12 months (360 days)</option>
            </select>
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium text-slate-700" htmlFor="notes">
              Notes (optional)
            </label>
            <textarea
              id="notes"
              className="min-h-20 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
              placeholder="Cash, bank transfer, invoice #..."
              value={form.notes}
              onChange={(e) => setForm({ ...form, notes: e.target.value })}
            />
          </div>

          {error && <p className="text-sm text-red-600">{error}</p>}

          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={resetAndClose}
              className="rounded-md border border-slate-300 px-4 py-2 text-sm hover:bg-slate-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={loading}
              className="rounded-md bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-60"
            >
              {loading ? "Saving…" : isEdit ? "Save changes" : "Record payment"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export function formatMoney(amount: number, currency: string) {
  return `${amount.toLocaleString(undefined, { maximumFractionDigits: 2 })} ${currency}`;
}

export function PaymentHistoryTable({
  payments,
  loading,
  onEdit,
}: {
  payments: Array<{
    id: number;
    amount: number;
    currency: string;
    period_months: number;
    period_days: number;
    paid_at: string;
    notes: string | null;
    recorded_by_name: string | null;
  }>;
  loading?: boolean;
  onEdit?: (payment: (typeof payments)[number]) => void;
}) {
  if (loading) return <p className="text-sm text-slate-500">Loading payments…</p>;
  if (!payments.length) {
    return <p className="text-sm text-slate-500">No payments recorded yet.</p>;
  }

  return (
    <div className="overflow-hidden rounded-xl border border-slate-200">
      <table className="min-w-full text-sm">
        <thead className="bg-slate-50 text-left text-slate-500">
          <tr>
            <th className="px-4 py-3 font-medium">Paid at</th>
            <th className="px-4 py-3 font-medium">Amount</th>
            <th className="px-4 py-3 font-medium">Period</th>
            <th className="px-4 py-3 font-medium">Notes</th>
            <th className="px-4 py-3 font-medium">Recorded by</th>
            {onEdit && <th className="px-4 py-3 font-medium text-right">Actions</th>}
          </tr>
        </thead>
        <tbody>
          {payments.map((payment) => (
            <tr key={payment.id} className="border-t border-slate-100">
              <td className="px-4 py-3 text-slate-600">{formatDate(payment.paid_at)}</td>
              <td className="px-4 py-3 font-medium text-slate-900">
                {formatMoney(payment.amount, payment.currency)}
              </td>
              <td className="px-4 py-3 text-slate-600">
                {payment.period_months} mo ({payment.period_days} days)
              </td>
              <td className="px-4 py-3 text-slate-600">{payment.notes ?? "—"}</td>
              <td className="px-4 py-3 text-slate-600">{payment.recorded_by_name ?? "—"}</td>
              {onEdit && (
                <td className="px-4 py-3 text-right">
                  <button
                    type="button"
                    onClick={() => onEdit(payment)}
                    className="text-sm text-indigo-600 hover:text-indigo-800"
                  >
                    Edit
                  </button>
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
