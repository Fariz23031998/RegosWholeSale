import { useEffect, useMemo, useState } from "react";
import {
  headersToRecord,
  recordToHeaderPairs,
  sendRawRequest,
  type HeaderPair,
  type RequestResult,
} from "@/lib/request";
import {
  applyViteProxy,
  buildRegosUrl,
  DEFAULT_BASE_URL,
  DEFAULT_PATH_PREFIX,
} from "@/lib/url";
import { loadJson, saveJson, STORAGE_KEYS } from "@/lib/storage";
import { BodyEditor } from "./BodyEditor";
import { HeadersEditor } from "./HeadersEditor";
import { OauthHelper } from "./OauthHelper";
import { ResponseViewer } from "./ResponseViewer";

type ApiRequestState = {
  baseUrl: string;
  token: string;
  pathPrefix: string;
  endpoint: string;
  method: string;
  headers: HeaderPair[];
  body: string;
};

const DEFAULT_HEADERS: HeaderPair[] = [
  {
    id: "content-type",
    key: "Content-Type",
    value: "application/json;charset=utf-8",
  },
  {
    id: "authorization",
    key: "Authorization",
    value: "",
  },
];

const DEFAULT_STATE: ApiRequestState = {
  baseUrl: DEFAULT_BASE_URL,
  token: "",
  pathPrefix: DEFAULT_PATH_PREFIX,
  endpoint: "DocWholeSale/Get",
  method: "POST",
  headers: DEFAULT_HEADERS,
  body: '{\n  \n}',
};

function normalizeLoadedState(raw: Partial<ApiRequestState> | null): ApiRequestState {
  if (!raw) return DEFAULT_STATE;
  return {
    baseUrl: raw.baseUrl ?? DEFAULT_STATE.baseUrl,
    token: raw.token ?? DEFAULT_STATE.token,
    pathPrefix: raw.pathPrefix ?? DEFAULT_STATE.pathPrefix,
    endpoint: raw.endpoint ?? DEFAULT_STATE.endpoint,
    method: raw.method ?? DEFAULT_STATE.method,
    headers:
      Array.isArray(raw.headers) && raw.headers.length > 0
        ? raw.headers
        : DEFAULT_STATE.headers,
    body: raw.body ?? DEFAULT_STATE.body,
  };
}

type Props = {
  useProxy: boolean;
};

export function ApiRequestPanel({ useProxy }: Props) {
  const [state, setState] = useState<ApiRequestState>(() =>
    normalizeLoadedState(loadJson(STORAGE_KEYS.apiRequest, DEFAULT_STATE)),
  );
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<RequestResult | null>(null);

  useEffect(() => {
    saveJson(STORAGE_KEYS.apiRequest, state);
  }, [state]);

  const fullUrl = useMemo(
    () =>
      buildRegosUrl({
        baseUrl: state.baseUrl,
        token: state.token,
        pathPrefix: state.pathPrefix,
        endpoint: state.endpoint,
      }),
    [state.baseUrl, state.token, state.pathPrefix, state.endpoint],
  );

  const requestUrl = useMemo(() => applyViteProxy(fullUrl, useProxy), [fullUrl, useProxy]);

  function setField<K extends keyof ApiRequestState>(key: K, value: ApiRequestState[K]) {
    setState((s) => ({ ...s, [key]: value }));
  }

  function setBearerToken(token: string) {
    setState((s) => {
      const headers = [...s.headers];
      const authIndex = headers.findIndex(
        (h) => h.key.trim().toLowerCase() === "authorization",
      );
      const value = token ? `Bearer ${token}` : "";
      if (authIndex >= 0) {
        headers[authIndex] = { ...headers[authIndex], value };
      } else {
        headers.push({ id: crypto.randomUUID(), key: "Authorization", value });
      }
      return { ...s, headers };
    });
  }

  async function send() {
    setLoading(true);
    setResult(null);
    const response = await sendRawRequest({
      method: state.method,
      url: requestUrl,
      headers: headersToRecord(state.headers),
      body: state.body,
    });
    setResult(response);
    setLoading(false);
  }

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <div className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block space-y-1 text-sm sm:col-span-2">
            <span className="font-medium text-slate-700">Base URL</span>
            <input
              value={state.baseUrl}
              onChange={(e) => setField("baseUrl", e.target.value)}
              className="mono w-full rounded-md border border-slate-300 bg-white px-2 py-1.5"
            />
          </label>
          <label className="block space-y-1 text-sm">
            <span className="font-medium text-slate-700">Integration token</span>
            <input
              value={state.token}
              onChange={(e) => setField("token", e.target.value)}
              placeholder="connected_integration_id"
              className="mono w-full rounded-md border border-slate-300 bg-white px-2 py-1.5"
            />
          </label>
          <label className="block space-y-1 text-sm">
            <span className="font-medium text-slate-700">Path prefix</span>
            <input
              value={state.pathPrefix}
              onChange={(e) => setField("pathPrefix", e.target.value)}
              className="mono w-full rounded-md border border-slate-300 bg-white px-2 py-1.5"
            />
          </label>
          <label className="block space-y-1 text-sm">
            <span className="font-medium text-slate-700">Endpoint</span>
            <input
              value={state.endpoint}
              onChange={(e) => setField("endpoint", e.target.value)}
              placeholder="DocWholeSale/Get"
              className="mono w-full rounded-md border border-slate-300 bg-white px-2 py-1.5"
            />
          </label>
          <label className="block space-y-1 text-sm">
            <span className="font-medium text-slate-700">Method</span>
            <input
              value={state.method}
              onChange={(e) => setField("method", e.target.value)}
              list="http-methods"
              className="mono w-full rounded-md border border-slate-300 bg-white px-2 py-1.5"
            />
            <datalist id="http-methods">
              <option value="POST" />
              <option value="GET" />
              <option value="PUT" />
              <option value="PATCH" />
              <option value="DELETE" />
              <option value="HEAD" />
              <option value="OPTIONS" />
            </datalist>
          </label>
        </div>

        <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2">
          <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            URL preview
          </div>
          <div className="mono mt-1 break-all text-sm text-slate-800">{fullUrl}</div>
          {useProxy && requestUrl !== fullUrl && (
            <div className="mono mt-1 break-all text-xs text-indigo-700">
              Proxied as: {requestUrl}
            </div>
          )}
        </div>

        <HeadersEditor
          headers={state.headers}
          onChange={(headers) => setField("headers", headers)}
        />

        <BodyEditor value={state.body} onChange={(body) => setField("body", body)} />

        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={send}
            disabled={loading}
            className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-60"
          >
            {loading ? "Sending…" : "Send request"}
          </button>
          <button
            type="button"
            onClick={() =>
              setField(
                "headers",
                recordToHeaderPairs({
                  "Content-Type": "application/json;charset=utf-8",
                  Authorization: "",
                }),
              )
            }
            className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700 hover:bg-slate-50"
          >
            Reset headers
          </button>
        </div>

        <OauthHelper useProxy={useProxy} onAccessToken={setBearerToken} />
      </div>

      <div>
        <h2 className="mb-3 text-sm font-semibold text-slate-800">Response</h2>
        <ResponseViewer result={result} loading={loading} />
      </div>
    </div>
  );
}
