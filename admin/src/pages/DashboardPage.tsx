import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { usePlatformAuth } from "@/store/platform-auth";
import { fetchStats } from "@/lib/platform-api";
import { formatMoney } from "@/components/RecordPaymentModal";

function StatCard({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
      <p className="text-sm text-slate-500">{label}</p>
      <p className="mt-2 text-3xl font-semibold text-slate-900">{value}</p>
    </div>
  );
}

export function DashboardPage() {
  const token = usePlatformAuth((s) => s.accessToken)!;
  const { data, isLoading, error } = useQuery({
    queryKey: ["stats"],
    queryFn: () => fetchStats(token),
  });

  if (isLoading) return <p className="text-slate-500">Loading…</p>;
  if (error || !data) return <p className="text-red-600">Failed to load dashboard</p>;

  return (
    <div>
      <h1 className="text-2xl font-semibold text-slate-900">Dashboard</h1>
      <p className="mt-1 text-sm text-slate-500">Subscription overview across all companies</p>
      <div className="mt-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        <StatCard label="Total companies" value={data.total} />
        <StatCard label="On trial" value={data.trial} />
        <StatCard label="Active" value={data.active} />
        <StatCard label="Expired" value={data.expired} />
        <StatCard label="Suspended" value={data.suspended} />
        <StatCard label="Expiring within 7 days" value={data.expiring_soon} />
        <StatCard label="Payment operations" value={data.payment_count} />
        <Link
          to="/payments"
          className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm transition hover:border-indigo-200 hover:bg-indigo-50/30"
        >
          <p className="text-sm text-slate-500">Payment total</p>
          <p className="mt-2 text-3xl font-semibold text-slate-900">
            {formatMoney(data.payment_total, "UZS")}
          </p>
          <p className="mt-1 text-xs text-indigo-600">View all payments →</p>
        </Link>
      </div>
    </div>
  );
}
