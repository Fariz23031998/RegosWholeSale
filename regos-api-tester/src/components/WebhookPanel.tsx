import { useEffect, useMemo, useState } from "react";
import {
  headersToRecord,
  sendRawRequest,
  type HeaderPair,
  type RequestResult,
} from "@/lib/request";
import { loadJson, saveJson, STORAGE_KEYS } from "@/lib/storage";
import {
  buildWebhookPayloadJson,
  WEBHOOK_EVENT_TEMPLATES,
  type WebhookEventTemplate,
} from "@/lib/webhookTemplates";
import { BodyEditor } from "./BodyEditor";
import { HeadersEditor } from "./HeadersEditor";
import { ResponseViewer } from "./ResponseViewer";

type WebhookState = {
  targetUrl: string;
  method: string;
  headers: HeaderPair[];
  body: string;
  eventId: string;
  connectedIntegrationId: string;
  documentId: string;
  resourceUuid: string;
};

type HistoryEntry = {
  id: string;
  at: string;
  action: string;
  targetUrl: string;
  status: number | null;
  ok: boolean;
  error: string | null;
  body: string;
};

const DEFAULT_HEADERS: HeaderPair[] = [
  {
    id: "content-type",
    key: "Content-Type",
    value: "application/json",
  },
];

const DEFAULT_STATE: WebhookState = {
  targetUrl: "http://localhost:8000/api/v1/regos/webhook",
  method: "POST",
  headers: DEFAULT_HEADERS,
  body: buildWebhookPayloadJson(WEBHOOK_EVENT_TEMPLATES[4], {
    eventId: `evt-${Date.now()}`,
    connectedIntegrationId: "",
    documentId: "1",
    resourceUuid: "00000000-0000-0000-0000-000000000001",
  }),
  eventId: `evt-${Date.now()}`,
  connectedIntegrationId: "",
  documentId: "1",
  resourceUuid: "00000000-0000-0000-0000-000000000001",
};

const HISTORY_LIMIT = 20;

function groupTemplates(templates: WebhookEventTemplate[]) {
  return {
    operation: templates.filter((t) => t.group === "operation"),
    payment: templates.filter((t) => t.group === "payment"),
    pos: templates.filter((t) => t.group === "pos"),
  };
}

export function WebhookPanel() {
  const [state, setState] = useState<WebhookState>(() =>
    loadJson(STORAGE_KEYS.webhook, DEFAULT_STATE),
  );
  const [history, setHistory] = useState<HistoryEntry[]>(() =>
    loadJson(STORAGE_KEYS.webhookHistory, []),
  );
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<RequestResult | null>(null);

  useEffect(() => {
    saveJson(STORAGE_KEYS.webhook, state);
  }, [state]);

  useEffect(() => {
    saveJson(STORAGE_KEYS.webhookHistory, history);
  }, [history]);

  const groups = useMemo(() => groupTemplates(WEBHOOK_EVENT_TEMPLATES), []);

  function setField<K extends keyof WebhookState>(key: K, value: WebhookState[K]) {
    setState((s) => ({ ...s, [key]: value }));
  }

  function applyTemplate(template: WebhookEventTemplate) {
    const eventId = state.eventId || `evt-${Date.now()}`;
    const body = buildWebhookPayloadJson(template, {
      eventId,
      connectedIntegrationId: state.connectedIntegrationId,
      documentId: state.documentId,
      resourceUuid: state.resourceUuid,
    });
    setState((s) => ({ ...s, eventId, body }));
  }

  async function send() {
    setLoading(true);
    setResult(null);
    const response = await sendRawRequest({
      method: state.method,
      url: state.targetUrl,
      headers: headersToRecord(state.headers),
      body: state.body,
    });
    setResult(response);
    setLoading(false);

    let action = "(custom)";
    try {
      const parsed = JSON.parse(state.body) as {
        data?: { action?: string };
      };
      if (parsed.data?.action) action = parsed.data.action;
    } catch {
      // keep custom label
    }

    const entry: HistoryEntry = {
      id: crypto.randomUUID(),
      at: new Date().toISOString(),
      action,
      targetUrl: state.targetUrl,
      status: response.status,
      ok: response.ok && !response.error,
      error: response.error,
      body: state.body,
    };
    setHistory((prev) => [entry, ...prev].slice(0, HISTORY_LIMIT));
  }

  function loadHistoryEntry(entry: HistoryEntry) {
    setState((s) => ({
      ...s,
      targetUrl: entry.targetUrl,
      body: entry.body,
    }));
  }

  function clearHistory() {
    setHistory([]);
  }

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <div className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block space-y-1 text-sm sm:col-span-2">
            <span className="font-medium text-slate-700">Target URL</span>
            <input
              value={state.targetUrl}
              onChange={(e) => setField("targetUrl", e.target.value)}
              className="mono w-full rounded-md border border-slate-300 bg-white px-2 py-1.5"
            />
          </label>
          <label className="block space-y-1 text-sm">
            <span className="font-medium text-slate-700">Method</span>
            <input
              value={state.method}
              onChange={(e) => setField("method", e.target.value)}
              className="mono w-full rounded-md border border-slate-300 bg-white px-2 py-1.5"
            />
          </label>
          <label className="block space-y-1 text-sm">
            <span className="font-medium text-slate-700">connected_integration_id</span>
            <input
              value={state.connectedIntegrationId}
              onChange={(e) => setField("connectedIntegrationId", e.target.value)}
              className="mono w-full rounded-md border border-slate-300 bg-white px-2 py-1.5"
            />
          </label>
          <label className="block space-y-1 text-sm">
            <span className="font-medium text-slate-700">event_id</span>
            <input
              value={state.eventId}
              onChange={(e) => setField("eventId", e.target.value)}
              className="mono w-full rounded-md border border-slate-300 bg-white px-2 py-1.5"
            />
          </label>
          <label className="block space-y-1 text-sm">
            <span className="font-medium text-slate-700">document id</span>
            <input
              value={state.documentId}
              onChange={(e) => setField("documentId", e.target.value)}
              className="mono w-full rounded-md border border-slate-300 bg-white px-2 py-1.5"
            />
          </label>
          <label className="block space-y-1 text-sm sm:col-span-2">
            <span className="font-medium text-slate-700">resource uuid (POS events)</span>
            <input
              value={state.resourceUuid}
              onChange={(e) => setField("resourceUuid", e.target.value)}
              className="mono w-full rounded-md border border-slate-300 bg-white px-2 py-1.5"
            />
          </label>
        </div>

        <div className="space-y-2">
          <div className="text-sm font-medium text-slate-700">Event templates</div>
          <p className="text-xs text-slate-500">
            Inserts a payload into the body editor. Fields stay fully editable.
          </p>
          {(
            [
              ["operation", "Operation documents"],
              ["payment", "Payments"],
              ["pos", "POS"],
            ] as const
          ).map(([key, title]) => (
            <div key={key}>
              <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">
                {title}
              </div>
              <div className="flex flex-wrap gap-1.5">
                {groups[key].map((template) => (
                  <button
                    key={template.action}
                    type="button"
                    onClick={() => applyTemplate(template)}
                    title={template.label}
                    className="rounded-md border border-slate-300 bg-white px-2 py-1 text-xs text-slate-700 hover:bg-indigo-50 hover:text-indigo-800"
                  >
                    {template.action}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>

        <HeadersEditor
          headers={state.headers}
          onChange={(headers) => setField("headers", headers)}
        />

        <BodyEditor value={state.body} onChange={(body) => setField("body", body)} rows={16} />

        <button
          type="button"
          onClick={send}
          disabled={loading}
          className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-60"
        >
          {loading ? "Sending…" : "Send webhook"}
        </button>

        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-medium text-slate-700">History</h3>
            {history.length > 0 && (
              <button
                type="button"
                onClick={clearHistory}
                className="text-xs text-slate-500 hover:text-red-600"
              >
                Clear
              </button>
            )}
          </div>
          {history.length === 0 ? (
            <p className="text-xs text-slate-500">No webhooks sent yet.</p>
          ) : (
            <ul className="max-h-56 space-y-1 overflow-auto">
              {history.map((entry) => (
                <li key={entry.id}>
                  <button
                    type="button"
                    onClick={() => loadHistoryEntry(entry)}
                    className="flex w-full items-center justify-between gap-2 rounded-md border border-slate-200 bg-white px-2 py-1.5 text-left text-xs hover:bg-slate-50"
                  >
                    <span className="mono truncate text-slate-800">{entry.action}</span>
                    <span
                      className={
                        entry.ok ? "text-emerald-700" : "text-red-700"
                      }
                    >
                      {entry.error ? "err" : entry.status ?? "—"}
                    </span>
                    <span className="shrink-0 text-slate-400">
                      {new Date(entry.at).toLocaleTimeString()}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      <div>
        <h2 className="mb-3 text-sm font-semibold text-slate-800">Response</h2>
        <ResponseViewer result={result} loading={loading} />
      </div>
    </div>
  );
}
