import { useEffect, useState } from "react";
import { ApiRequestPanel } from "@/components/ApiRequestPanel";
import { WebhookPanel } from "@/components/WebhookPanel";
import { loadJson, saveJson, STORAGE_KEYS } from "@/lib/storage";

type Tab = "api" | "webhook";

export default function App() {
  const [tab, setTab] = useState<Tab>(() => loadJson(STORAGE_KEYS.activeTab, "api"));
  const [useProxy, setUseProxy] = useState(() =>
    loadJson(STORAGE_KEYS.useProxy, import.meta.env.DEV),
  );

  useEffect(() => {
    saveJson(STORAGE_KEYS.activeTab, tab);
  }, [tab]);

  useEffect(() => {
    saveJson(STORAGE_KEYS.useProxy, useProxy);
  }, [useProxy]);

  return (
    <div className="min-h-screen">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-3 px-4 py-4">
          <div>
            <h1 className="text-lg font-semibold text-slate-900">Regos API Tester</h1>
            <p className="text-sm text-slate-500">
              Freeform requests to Regos API and webhook receivers. No validation, no app auth.
            </p>
          </div>
          <label className="flex items-center gap-2 rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700">
            <input
              type="checkbox"
              checked={useProxy}
              onChange={(e) => setUseProxy(e.target.checked)}
              className="rounded border-slate-300"
            />
            Use Vite proxy
            <span className="text-xs text-slate-500">(CORS bypass for Regos hosts)</span>
          </label>
        </div>
        <div className="mx-auto flex max-w-7xl gap-1 px-4">
          {(
            [
              ["api", "API Request"],
              ["webhook", "Webhook Tester"],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              onClick={() => setTab(id)}
              className={`border-b-2 px-4 py-2 text-sm font-medium transition-colors ${
                tab === id
                  ? "border-indigo-600 text-indigo-700"
                  : "border-transparent text-slate-500 hover:text-slate-800"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-4 py-6">
        {tab === "api" ? <ApiRequestPanel useProxy={useProxy} /> : <WebhookPanel />}
      </main>
    </div>
  );
}
