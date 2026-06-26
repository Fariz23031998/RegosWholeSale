import { useState } from "react";
import { Link, useParams } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { PaymentHistoryTable, RecordPaymentModal, toDatetimeLocalValue } from "@/components/RecordPaymentModal";
import { StatusBadge, formatDate } from "@/components/StatusBadge";
import {
  fetchCompany,
  fetchCompanyPayments,
  recordCompanyPayment,
  updateCompany,
  updatePayment,
} from "@/lib/platform-api";
import type { SubscriptionPayment } from "@/lib/platform-api";
import { usePlatformAuth } from "@/store/platform-auth";

export function CompanyDetailPage() {
  const { id } = useParams({ strict: false });
  const companyId = Number(id);
  const token = usePlatformAuth((s) => s.accessToken)!;
  const queryClient = useQueryClient();
  const [notes, setNotes] = useState("");
  const [showPaymentModal, setShowPaymentModal] = useState(false);
  const [editPayment, setEditPayment] = useState<SubscriptionPayment | null>(null);

  const { data, isLoading, error } = useQuery({
    queryKey: ["company", companyId],
    queryFn: async () => {
      const company = await fetchCompany(token, companyId);
      setNotes(company.internal_notes ?? "");
      return company;
    },
  });

  const { data: payments, isLoading: paymentsLoading } = useQuery({
    queryKey: ["company-payments", companyId],
    queryFn: () => fetchCompanyPayments(token, companyId),
  });

  const updateMutation = useMutation({
    mutationFn: (body: {
      status?: string;
      extend_days?: number;
      internal_notes?: string;
      reset_subscription?: boolean;
    }) => updateCompany(token, companyId, body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["company", companyId] });
      queryClient.invalidateQueries({ queryKey: ["companies"] });
      queryClient.invalidateQueries({ queryKey: ["stats"] });
    },
  });

  const paymentMutation = useMutation({
    mutationFn: (body: { amount: number; currency: string; period_months: number; notes?: string }) =>
      recordCompanyPayment(token, companyId, body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["company", companyId] });
      queryClient.invalidateQueries({ queryKey: ["company-payments", companyId] });
      queryClient.invalidateQueries({ queryKey: ["companies"] });
      queryClient.invalidateQueries({ queryKey: ["stats"] });
      queryClient.invalidateQueries({ queryKey: ["payments"] });
      setShowPaymentModal(false);
    },
  });

  const editPaymentMutation = useMutation({
    mutationFn: (values: {
      amount: number;
      currency: string;
      period_months: number;
      paid_at: string;
      notes?: string;
    }) =>
      updatePayment(token, editPayment!.id, {
        amount: values.amount,
        currency: values.currency,
        period_months: values.period_months,
        paid_at: values.paid_at,
        notes: values.notes,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["company-payments", companyId] });
      queryClient.invalidateQueries({ queryKey: ["payments"] });
      queryClient.invalidateQueries({ queryKey: ["stats"] });
      setEditPayment(null);
    },
  });

  if (isLoading) return <p className="text-slate-500">Loading…</p>;
  if (error || !data) return <p className="text-red-600">Company not found</p>;

  return (
    <div>
      <Link to="/companies" className="text-sm text-indigo-600 hover:underline">
        ← Back to companies
      </Link>
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-semibold text-slate-900">{data.name}</h1>
        <StatusBadge status={data.subscription_status} />
      </div>
      <p className="mt-1 text-sm text-slate-500">{data.slug}</p>

      <div className="mt-6 grid gap-4 lg:grid-cols-2">
        <div className="rounded-xl border border-slate-200 bg-white p-5">
          <h2 className="font-medium text-slate-900">Details</h2>
          <dl className="mt-3 space-y-2 text-sm">
            <div className="flex justify-between gap-4">
              <dt className="text-slate-500">Owner</dt>
              <dd>{data.owner?.email ?? "—"}</dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-slate-500">Users</dt>
              <dd>{data.user_count}</dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-slate-500">Created</dt>
              <dd>{formatDate(data.created_at)}</dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-slate-500">Expires</dt>
              <dd>{formatDate(data.subscription_expires_at)}</dd>
            </div>
          </dl>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-5">
          <h2 className="font-medium text-slate-900">Subscription</h2>
          <p className="mt-1 text-sm text-slate-500">
            Record a manual payment to activate or extend access.
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => setShowPaymentModal(true)}
              className="rounded-md bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700"
            >
              Record payment
            </button>
            <button
              type="button"
              disabled={updateMutation.isPending}
              onClick={() => updateMutation.mutate({ status: "suspended" })}
              className="rounded-md border border-amber-300 px-3 py-1.5 text-sm text-amber-800 hover:bg-amber-50 disabled:opacity-60"
            >
              Suspend
            </button>
            <button
              type="button"
              disabled={updateMutation.isPending}
              onClick={() => {
                if (
                  window.confirm(
                    "Reset subscription to a fresh trial? This does not delete payment history.",
                  )
                ) {
                  updateMutation.mutate({ reset_subscription: true });
                }
              }}
              className="rounded-md border border-slate-300 px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50 disabled:opacity-60"
            >
              Reset subscription
            </button>
          </div>
          {(updateMutation.isError || paymentMutation.isError || editPaymentMutation.isError) && (
            <p className="mt-2 text-sm text-red-600">
              {(
                (updateMutation.error ?? paymentMutation.error ?? editPaymentMutation.error) as Error
              ).message}
            </p>
          )}
        </div>
      </div>

      <div className="mt-4 rounded-xl border border-slate-200 bg-white p-5">
        <h2 className="font-medium text-slate-900">Payment history</h2>
        <div className="mt-3">
          <PaymentHistoryTable
            payments={payments ?? []}
            loading={paymentsLoading}
            onEdit={(payment) => {
              const full = payments?.find((p) => p.id === payment.id);
              if (full) setEditPayment(full);
            }}
          />
        </div>
      </div>

      <div className="mt-4 rounded-xl border border-slate-200 bg-white p-5">
        <h2 className="font-medium text-slate-900">Internal notes</h2>
        <textarea
          className="mt-3 min-h-24 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
        />
        <button
          type="button"
          disabled={updateMutation.isPending}
          onClick={() => updateMutation.mutate({ internal_notes: notes })}
          className="mt-2 rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-60"
        >
          Save notes
        </button>
      </div>

      <RecordPaymentModal
        companyName={data.name}
        open={showPaymentModal}
        loading={paymentMutation.isPending}
        error={paymentMutation.isError ? (paymentMutation.error as Error).message : undefined}
        onClose={() => setShowPaymentModal(false)}
        onSubmit={(values) =>
          paymentMutation.mutate({
            amount: Number(values.amount),
            currency: values.currency,
            period_months: Number(values.period_months),
            notes: values.notes.trim() || undefined,
          })
        }
      />

      <RecordPaymentModal
        companyName={data.name}
        open={editPayment != null}
        mode="edit"
        loading={editPaymentMutation.isPending}
        error={
          editPaymentMutation.isError ? (editPaymentMutation.error as Error).message : undefined
        }
        initialValues={
          editPayment
            ? {
                amount: String(editPayment.amount),
                currency: editPayment.currency,
                period_months: String(editPayment.period_months),
                notes: editPayment.notes ?? "",
                paid_at: toDatetimeLocalValue(editPayment.paid_at),
              }
            : undefined
        }
        onClose={() => setEditPayment(null)}
        onSubmit={(values) =>
          editPaymentMutation.mutate({
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
