import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { StatusBadge, formatDate } from "@/components/StatusBadge";
import { createCompany, fetchCompanies, updateCompany, recordCompanyPayment } from "@/lib/platform-api";
import { RecordPaymentModal } from "@/components/RecordPaymentModal";
import { usePlatformAuth } from "@/store/platform-auth";

function isDeactivated(status: string) {
  return status === "suspended" || status === "expired";
}

export function CompaniesPage() {
  const token = usePlatformAuth((s) => s.accessToken)!;
  const queryClient = useQueryClient();
  const [status, setStatus] = useState("");
  const [search, setSearch] = useState("");
  const [showCreate, setShowCreate] = useState(false);
  const [updatingId, setUpdatingId] = useState<number | null>(null);
  const [paymentTarget, setPaymentTarget] = useState<{ id: number; name: string } | null>(null);
  const [form, setForm] = useState({
    company_name: "",
    owner_email: "",
    owner_password: "",
    owner_display_name: "",
    active_days: "30",
  });

  const { data, isLoading } = useQuery({
    queryKey: ["companies", status, search],
    queryFn: () =>
      fetchCompanies(token, {
        status: status || undefined,
        search: search || undefined,
        limit: 100,
      }),
  });

  const statusMutation = useMutation({
    mutationFn: async ({
      companyId,
      nextStatus,
    }: {
      companyId: number;
      nextStatus: "suspended";
    }) => {
      setUpdatingId(companyId);
      return updateCompany(token, companyId, { status: nextStatus });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["companies"] });
      queryClient.invalidateQueries({ queryKey: ["stats"] });
      queryClient.invalidateQueries({ queryKey: ["payments"] });
    },
    onSettled: () => setUpdatingId(null),
  });

  const paymentMutation = useMutation({
    mutationFn: async ({
      companyId,
      amount,
      currency,
      period_months,
      notes,
    }: {
      companyId: number;
      amount: number;
      currency: string;
      period_months: number;
      notes?: string;
    }) => {
      setUpdatingId(companyId);
      return recordCompanyPayment(token, companyId, { amount, currency, period_months, notes });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["companies"] });
      queryClient.invalidateQueries({ queryKey: ["stats"] });
      queryClient.invalidateQueries({ queryKey: ["payments"] });
      setPaymentTarget(null);
    },
    onSettled: () => setUpdatingId(null),
  });

  const deactivateCompany = (companyId: number, companyName: string) => {
    if (
      !window.confirm(
        `Deactivate "${companyName}"? Users will lose access until you activate the company again.`,
      )
    ) {
      return;
    }
    statusMutation.mutate({ companyId, nextStatus: "suspended" });
  };

  const activateCompany = (companyId: number, companyName: string) => {
    setPaymentTarget({ id: companyId, name: companyName });
  };

  const createMutation = useMutation({
    mutationFn: () =>
      createCompany(token, {
        company_name: form.company_name,
        owner_email: form.owner_email,
        owner_password: form.owner_password,
        owner_display_name: form.owner_display_name,
        active_days: Number(form.active_days) || 30,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["companies"] });
      queryClient.invalidateQueries({ queryKey: ["stats"] });
      queryClient.invalidateQueries({ queryKey: ["payments"] });
      setShowCreate(false);
      setForm({
        company_name: "",
        owner_email: "",
        owner_password: "",
        owner_display_name: "",
        active_days: "30",
      });
    },
  });

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">Companies</h1>
          <p className="mt-1 text-sm text-slate-500">{data?.total ?? 0} total</p>
        </div>
        <button
          type="button"
          onClick={() => setShowCreate((v) => !v)}
          className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700"
        >
          {showCreate ? "Cancel" : "Create company"}
        </button>
      </div>

      {showCreate && (
        <form
          className="mt-4 grid gap-3 rounded-xl border border-slate-200 bg-white p-4 md:grid-cols-2"
          onSubmit={(e) => {
            e.preventDefault();
            createMutation.mutate();
          }}
        >
          <input
            className="rounded-md border border-slate-300 px-3 py-2 text-sm"
            placeholder="Company name"
            value={form.company_name}
            onChange={(e) => setForm({ ...form, company_name: e.target.value })}
            required
          />
          <input
            className="rounded-md border border-slate-300 px-3 py-2 text-sm"
            placeholder="Owner display name"
            value={form.owner_display_name}
            onChange={(e) => setForm({ ...form, owner_display_name: e.target.value })}
            required
          />
          <input
            type="email"
            className="rounded-md border border-slate-300 px-3 py-2 text-sm"
            placeholder="Owner email"
            value={form.owner_email}
            onChange={(e) => setForm({ ...form, owner_email: e.target.value })}
            required
          />
          <input
            type="password"
            className="rounded-md border border-slate-300 px-3 py-2 text-sm"
            placeholder="Owner password"
            value={form.owner_password}
            onChange={(e) => setForm({ ...form, owner_password: e.target.value })}
            required
          />
          <input
            type="number"
            min={1}
            className="rounded-md border border-slate-300 px-3 py-2 text-sm"
            placeholder="Active days"
            value={form.active_days}
            onChange={(e) => setForm({ ...form, active_days: e.target.value })}
          />
          <button
            type="submit"
            disabled={createMutation.isPending}
            className="rounded-md bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-60"
          >
            {createMutation.isPending ? "Creating…" : "Create"}
          </button>
          {createMutation.isError && (
            <p className="text-sm text-red-600 md:col-span-2">
              {(createMutation.error as Error).message}
            </p>
          )}
        </form>
      )}

      <div className="mt-4 flex flex-wrap gap-2">
        <input
          className="min-w-[200px] flex-1 rounded-md border border-slate-300 px-3 py-2 text-sm"
          placeholder="Search name, slug, owner email…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <select
          className="rounded-md border border-slate-300 px-3 py-2 text-sm"
          value={status}
          onChange={(e) => setStatus(e.target.value)}
        >
          <option value="">All statuses</option>
          <option value="trial">Trial</option>
          <option value="active">Active</option>
          <option value="expired">Expired</option>
          <option value="suspended">Suspended</option>
        </select>
      </div>

      <div className="mt-4 overflow-hidden rounded-xl border border-slate-200 bg-white">
        <table className="min-w-full text-sm">
          <thead className="bg-slate-50 text-left text-slate-500">
            <tr>
              <th className="px-4 py-3 font-medium">Company</th>
              <th className="px-4 py-3 font-medium">Owner</th>
              <th className="px-4 py-3 font-medium">Status</th>
              <th className="px-4 py-3 font-medium">Expires</th>
              <th className="px-4 py-3 font-medium">Users</th>
              <th className="px-4 py-3 font-medium text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              <tr>
                <td className="px-4 py-6 text-slate-500" colSpan={6}>
                  Loading…
                </td>
              </tr>
            ) : (
              data?.items.map((company) => (
                <tr key={company.id} className="border-t border-slate-100">
                  <td className="px-4 py-3">
                    <Link
                      to="/companies/$id"
                      params={{ id: String(company.id) }}
                      className="font-medium text-indigo-600 hover:underline"
                    >
                      {company.name}
                    </Link>
                    <p className="text-xs text-slate-500">{company.slug}</p>
                  </td>
                  <td className="px-4 py-3 text-slate-600">{company.owner_email ?? "—"}</td>
                  <td className="px-4 py-3">
                    <StatusBadge status={company.subscription_status} />
                  </td>
                  <td className="px-4 py-3 text-slate-600">
                    {formatDate(company.subscription_expires_at)}
                  </td>
                  <td className="px-4 py-3 text-slate-600">{company.user_count}</td>
                  <td className="px-4 py-3 text-right">
                    {isDeactivated(company.subscription_status) ? (
                      <button
                        type="button"
                        disabled={updatingId === company.id}
                        onClick={() => activateCompany(company.id, company.name)}
                        className="rounded-md border border-emerald-300 px-3 py-1.5 text-sm text-emerald-800 hover:bg-emerald-50 disabled:opacity-60"
                      >
                        {updatingId === company.id ? "Saving…" : "Activate & pay"}
                      </button>
                    ) : (
                      <button
                        type="button"
                        disabled={updatingId === company.id}
                        onClick={() => deactivateCompany(company.id, company.name)}
                        className="rounded-md border border-red-300 px-3 py-1.5 text-sm text-red-700 hover:bg-red-50 disabled:opacity-60"
                      >
                        {updatingId === company.id ? "Saving…" : "Deactivate"}
                      </button>
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
        {statusMutation.isError && (
          <p className="border-t border-slate-100 px-4 py-3 text-sm text-red-600">
            {(statusMutation.error as Error).message}
          </p>
        )}
      </div>

      <RecordPaymentModal
        companyName={paymentTarget?.name ?? ""}
        open={paymentTarget != null}
        loading={paymentMutation.isPending}
        error={paymentMutation.isError ? (paymentMutation.error as Error).message : undefined}
        onClose={() => setPaymentTarget(null)}
        onSubmit={(values) => {
          if (!paymentTarget) return;
          paymentMutation.mutate({
            companyId: paymentTarget.id,
            amount: Number(values.amount),
            currency: values.currency,
            period_months: Number(values.period_months),
            notes: values.notes.trim() || undefined,
          });
        }}
      />
    </div>
  );
}
