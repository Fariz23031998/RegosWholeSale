export type HeaderPair = { id: string; key: string; value: string };

export type RequestResult = {
  ok: boolean;
  status: number | null;
  statusText: string;
  headers: Record<string, string>;
  body: string;
  durationMs: number;
  error: string | null;
  url: string;
  method: string;
};

export function headersToRecord(pairs: HeaderPair[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const pair of pairs) {
    const key = pair.key.trim();
    if (!key) continue;
    out[key] = pair.value;
  }
  return out;
}

export function recordToHeaderPairs(record: Record<string, string>): HeaderPair[] {
  return Object.entries(record).map(([key, value]) => ({
    id: crypto.randomUUID(),
    key,
    value,
  }));
}

export async function sendRawRequest(options: {
  method: string;
  url: string;
  headers: Record<string, string>;
  body: string | null;
}): Promise<RequestResult> {
  const started = performance.now();
  const method = options.method.trim() || "GET";
  const upper = method.toUpperCase();
  const hasBody = options.body !== null && options.body !== undefined;
  const bodyAllowed = !["GET", "HEAD"].includes(upper);

  try {
    const response = await fetch(options.url, {
      method,
      headers: options.headers,
      body: hasBody && bodyAllowed ? options.body : undefined,
    });

    const durationMs = Math.round(performance.now() - started);
    const headers: Record<string, string> = {};
    response.headers.forEach((value, key) => {
      headers[key] = value;
    });

    const body = await response.text();

    return {
      ok: response.ok,
      status: response.status,
      statusText: response.statusText,
      headers,
      body,
      durationMs,
      error: null,
      url: options.url,
      method,
    };
  } catch (err) {
    const durationMs = Math.round(performance.now() - started);
    const message = err instanceof Error ? err.message : String(err);
    return {
      ok: false,
      status: null,
      statusText: "",
      headers: {},
      body: "",
      durationMs,
      error: message,
      url: options.url,
      method,
    };
  }
}

export function tryFormatJson(text: string): string | null {
  try {
    return JSON.stringify(JSON.parse(text), null, 2);
  } catch {
    return null;
  }
}

export function softJsonWarning(text: string): string | null {
  if (!text.trim()) return null;
  try {
    JSON.parse(text);
    return null;
  } catch (err) {
    return err instanceof Error ? err.message : "Invalid JSON";
  }
}
