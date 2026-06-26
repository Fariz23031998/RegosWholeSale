import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { formatDate } from "@/components/StatusBadge";
import {
  formatMoney,
  RecordPaymentModal,
  toDatetimeLocalValue,
} from "@/components/RecordPaymentModal";
import { fetchPayments, updatePayment, type SubscriptionPaymentListItem } from "@/lib/platform-api";
import { usePlatformAuth } from "@/store/platform-auth";

export function PaymentsPage() {
  const token = usePlatformAuth((s) => s.accessToken)!;
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [editTarget, setEditTarget] = useState<SubscriptionPaymentListItem | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ["payments", search],
    queryFn: () =>
      fetchPayments(token, {
        search: search || undefined,
        limit: 200,
      }),
  });

  const editMutation = useMutation({
    mutationFn: (values: {
      amount: number;
      currency: string;
      period_months: number;
      paid_at: string;
      notes?: string;
    }) =>
      updatePayment(token, editTarget!.id, {
        amount: values.amount,
        currency: values.currency,
        period_months: values.period_months,
        paid_at: values.paid_at,
        notes: values.notes,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["payments"] });
      queryClient.invalidateQueries({ queryKey: ["stats"] });
      setEditTarget(null);
    },
  });

  return (
    <div>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">Payments</h1>
          <p className="mt-1 text-sm text-slate-500">
            All subscription payments across companies
            {data != null && ` · ${data.total} total`}
          </p>
        </div>
      </div>

      <div className="mt-4">
        <input
          type="search"
          placeholder="Search by company, notes, or currency…"
          className="w-full max-w-md rounded-md border border-slate-300 px-3 py-2 text-sm"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      <div className="mt-4 overflow-hidden rounded-xl border border-slate-200 bg-white">
        <table className="min-w-full text-sm">
          <thead className="bg-slate-50 text-left text-slate-500">
            <tr>
              <th className="px-4 py-3 font-medium">Paid at</th>
              <th className="px-4 py-3 font-medium">Company</th>
              <th className="px-4 py-3 font-medium">Amount</th>
              <th className="px-4 py-3 font-medium">Period</th>
              <th className="px-4 py-3 font-medium">Notes</th>
              <th className="px-4 py-3 font-medium">Recorded by</th>
              <th className="px-4 py-3 font-medium text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              <tr>
                <td colSpan={7} className="px-4 py-8 text-center text-slate-500">
                  Loading…
                </td>
              </tr>
            ) : !data?.items.length ? (
              <tr>
                <td colSpan={7} className="px-4 py-8 text-center text-slate-500">
                  No payments found.
                </td>
              </tr>
            ) : (
              data.items.map((payment) => (
                <tr key={payment.id} className="border-t border-slate-100">
                  <td className="px-4 py-3 text-slate-600">{formatDate(payment.paid_at)}</td>
                  <td className="px-4 py-3">
                    <Link
                      to="/companies/$id"
                      params={{ id: String(payment.company_id) }}
                      className="font-medium text-indigo-600 hover:text-indigo-800"
                    >
                      {payment.company_name}
                    </Link>
                  </td>
                  <td className="px-4 py-3 font-medium text-slate-900">
                    {formatMoney(payment.amount, payment.currency)}
                  </td>
                  <td className="px-4 py-3 text-slate-600">
                    {payment.period_months} mo ({payment.period_days} days)
                  </td>
                  <td className="px-4 py-3 text-slate-600">{payment.notes ?? "—"}</td>
                  <td className="px-4 py-3 text-slate-600">{payment.recorded_by_name ?? "—"}</td>
                  <td className="px-4 py-3 text-right">
                    <button
                      type="button"
                      onClick={() => setEditTarget(payment)}
                      className="text-sm text-indigo-600 hover:text-indigo-800"
                    >
                      Edit
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {editMutation.isError && (
        <p className="mt-3 text-sm text-red-600">{(editMutation.error as Error).message}</p>
      )}

      <RecordPaymentModal
        companyName={editTarget?.company_name ?? ""}
        open={editTarget != null}
        mode="edit"
        loading={editMutation.isPending}
        error={editMutation.isError ? (editMutation.error as Error).message : undefined}
        initialValues={
          editTarget
            ? {
                amount: String(editTarget.amount),
                currency: editTarget.currency,
                period_months: String(editTarget.period_months),
                notes: editTarget.notes ?? "",
                paid_at: toDatetimeLocalValue(editTarget.paid_at),
              }
            : undefined
        }
        onClose={() => setEditTarget(null)}
        onSubmit={(values) =>
          editMutation.mutate({
            amount: Number(values.amount),
            currency: values.currency,
            period_months: Number(values.period_months),
            paid_at: new Date(values.paid_at).toISOString(),
            notes: values.notes.trim() || undefined,
          })
        }
      />
    </div>
  );
}
