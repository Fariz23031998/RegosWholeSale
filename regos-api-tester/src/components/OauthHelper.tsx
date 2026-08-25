import { useEffect, useState } from "react";
import {
  headersToRecord,
  sendRawRequest,
  type RequestResult,
} from "@/lib/request";
import { applyViteProxy, DEFAULT_OAUTH_TOKEN_URL } from "@/lib/url";
import { loadJson, saveJson, STORAGE_KEYS } from "@/lib/storage";
import { ResponseViewer } from "./ResponseViewer";

type OauthState = {
  clientId: string;
  clientSecret: string;
  tokenUrl: string;
};

const DEFAULT_OAUTH: OauthState = {
  clientId: "",
  clientSecret: "",
  tokenUrl: DEFAULT_OAUTH_TOKEN_URL,
};

type Props = {
  useProxy: boolean;
  onAccessToken: (token: string) => void;
};

export function OauthHelper({ useProxy, onAccessToken }: Props) {
  const [open, setOpen] = useState(false);
  const [state, setState] = useState<OauthState>(() =>
    loadJson(STORAGE_KEYS.oauth, DEFAULT_OAUTH),
  );
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<RequestResult | null>(null);

  useEffect(() => {
    saveJson(STORAGE_KEYS.oauth, state);
  }, [state]);

  async function acquireToken() {
    setLoading(true);
    setResult(null);

    const form = new URLSearchParams();
    form.set("grant_type", "client_credentials");
    form.set("client_id", state.clientId);
    form.set("client_secret", state.clientSecret);

    const url = applyViteProxy(state.tokenUrl, useProxy);
    const response = await sendRawRequest({
      method: "POST",
      url,
      headers: headersToRecord([
        {
          id: "ct",
          key: "Content-Type",
          value: "application/x-www-form-urlencoded",
        },
      ]),
      body: form.toString(),
    });

    setResult(response);
    setLoading(false);

    if (!response.error && response.body) {
      try {
        const data = JSON.parse(response.body) as { access_token?: string };
        if (typeof data.access_token === "string" && data.access_token) {
          onAccessToken(data.access_token);
        }
      } catch {
        // leave body as-is; user can copy manually
      }
    }
  }

  return (
    <div className="rounded-lg border border-slate-200 bg-slate-50">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between px-4 py-3 text-left text-sm font-medium text-slate-800"
      >
        <span>OAuth helper (client credentials)</span>
        <span className="text-slate-500">{open ? "Hide" : "Show"}</span>
      </button>

      {open && (
        <div className="space-y-3 border-t border-slate-200 px-4 py-4">
          <p className="text-xs text-slate-500">
            Acquires an access token and fills the Authorization Bearer header. This is a request
            helper, not app authentication.
          </p>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block space-y-1 text-sm">
              <span className="font-medium text-slate-700">Client ID</span>
              <input
                value={state.clientId}
                onChange={(e) => setState((s) => ({ ...s, clientId: e.target.value }))}
                className="mono w-full rounded-md border border-slate-300 bg-white px-2 py-1.5"
              />
            </label>
            <label className="block space-y-1 text-sm">
              <span className="font-medium text-slate-700">Client secret</span>
              <input
                type="password"
                value={state.clientSecret}
                onChange={(e) => setState((s) => ({ ...s, clientSecret: e.target.value }))}
                className="mono w-full rounded-md border border-slate-300 bg-white px-2 py-1.5"
              />
            </label>
          </div>
          <label className="block space-y-1 text-sm">
            <span className="font-medium text-slate-700">Token URL</span>
            <input
              value={state.tokenUrl}
              onChange={(e) => setState((s) => ({ ...s, tokenUrl: e.target.value }))}
              className="mono w-full rounded-md border border-slate-300 bg-white px-2 py-1.5"
            />
          </label>
          <button
            type="button"
            onClick={acquireToken}
            disabled={loading}
            className="rounded-md bg-slate-800 px-3 py-2 text-sm font-medium text-white hover:bg-slate-700 disabled:opacity-60"
          >
            {loading ? "Requesting…" : "Get access token"}
          </button>
          <ResponseViewer result={result} loading={loading} />
        </div>
      )}
    </div>
  );
}
