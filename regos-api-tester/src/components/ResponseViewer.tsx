import { tryFormatJson, type RequestResult } from "@/lib/request";

type Props = {
  result: RequestResult | null;
  loading?: boolean;
};

export function ResponseViewer({ result, loading }: Props) {
  if (loading) {
    return (
      <div className="rounded-lg border border-slate-200 bg-white p-4 text-sm text-slate-600">
        Sending request…
      </div>
    );
  }

  if (!result) {
    return (
      <div className="rounded-lg border border-dashed border-slate-300 bg-white p-4 text-sm text-slate-500">
        Response will appear here after you send a request.
      </div>
    );
  }

  const displayBody = tryFormatJson(result.body) ?? result.body;
  const statusLabel =
    result.status != null ? `${result.status} ${result.statusText}`.trim() : "No status";
  const statusColor = result.error
    ? "text-red-700 bg-red-50 border-red-200"
    : result.ok
      ? "text-emerald-800 bg-emerald-50 border-emerald-200"
      : "text-amber-800 bg-amber-50 border-amber-200";

  return (
    <div className="space-y-3 rounded-lg border border-slate-200 bg-white p-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className={`rounded-md border px-2 py-1 text-xs font-semibold ${statusColor}`}>
          {result.error ? "Error" : statusLabel}
        </span>
        <span className="text-xs text-slate-500">{result.durationMs} ms</span>
        <span className="mono text-xs text-slate-500">
          {result.method} {result.url}
        </span>
      </div>

      {result.error && (
        <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
          {result.error}
        </div>
      )}

      {Object.keys(result.headers).length > 0 && (
        <div>
          <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">
            Response headers
          </h3>
          <pre className="mono max-h-40 overflow-auto rounded-md bg-slate-50 p-3 text-xs text-slate-700">
            {Object.entries(result.headers)
              .map(([k, v]) => `${k}: ${v}`)
              .join("\n")}
          </pre>
        </div>
      )}

      <div>
        <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">
          Response body
        </h3>
        <pre className="mono max-h-[28rem] overflow-auto rounded-md bg-slate-900 p-3 text-xs text-slate-100">
          {displayBody || "(empty)"}
        </pre>
      </div>
    </div>
  );
}
