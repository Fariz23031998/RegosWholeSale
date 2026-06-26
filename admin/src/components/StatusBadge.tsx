import clsx from "clsx";

export function StatusBadge({ status }: { status: string }) {
  const styles: Record<string, string> = {
    trial: "bg-amber-100 text-amber-800",
    active: "bg-emerald-100 text-emerald-800",
    expired: "bg-red-100 text-red-800",
    suspended: "bg-slate-200 text-slate-700",
  };
  return (
    <span
      className={clsx(
        "inline-flex rounded-full px-2 py-0.5 text-xs font-medium capitalize",
        styles[status] ?? "bg-slate-100 text-slate-700",
      )}
    >
      {status}
    </span>
  );
}

export function formatDate(value: string) {
  return new Date(value).toLocaleString();
}
