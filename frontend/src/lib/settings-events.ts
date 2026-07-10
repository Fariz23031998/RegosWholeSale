import { getApiBaseUrl } from "@/lib/api";
import { refreshSettingsNamespace } from "@/lib/settings-api";

export const SETTINGS_EVENTS_CHANNEL = "pulse-pos-settings-events";

const settingsEventsSourceId =
  typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : String(Date.now());

const SETTINGS_EVENT_DEBOUNCE_MS = 250;
const pendingSettingsEvents = new Map<string, SettingsEventMessage>();
let flushSettingsEventsTimer: ReturnType<typeof setTimeout> | null = null;

export type SettingsEventNamespace =
  | "pos"
  | "regos_defaults"
  | "receipt_templates"
  | "exchange_rate_sync"
  | "regos_token"
  | "payment_linking"
  | "doc_payment_sale_id";

export type SettingsEventMessage = {
  type: "settings_updated";
  scope: "company" | "employee";
  namespace: SettingsEventNamespace;
  user_id?: number;
  occurred_at: string;
};

export type SettingsEventHandlers = {
  onCompanySettingsUpdated?: (namespace: SettingsEventNamespace) => void;
  onEmployeeSettingsUpdated?: (namespace: SettingsEventNamespace) => void;
};

export type SettingsEventConnection = {
  close: () => void;
};

type SettingsEventContext = {
  companyId: number;
  userId: number;
};

type SettingsEventListener = (event: SettingsEventMessage) => void;

const settingsEventListeners = new Set<SettingsEventListener>();

function notifySettingsEventListeners(event: SettingsEventMessage): void {
  for (const listener of settingsEventListeners) {
    try {
      listener(event);
    } catch {
      // ignore listener failures
    }
  }
}

export function subscribeSettingsEvents(listener: SettingsEventListener): () => void {
  settingsEventListeners.add(listener);
  return () => {
    settingsEventListeners.delete(listener);
  };
}

function parseSettingsEvent(data: string): SettingsEventMessage | null {
  try {
    const parsed = JSON.parse(data) as SettingsEventMessage;
    if (!parsed || typeof parsed !== "object" || parsed.type !== "settings_updated") return null;
    return parsed;
  } catch {
    return null;
  }
}

function broadcastSettingsEvent(event: SettingsEventMessage): void {
  if (typeof BroadcastChannel === "undefined") return;
  try {
    const channel = new BroadcastChannel(SETTINGS_EVENTS_CHANNEL);
    channel.postMessage({ sourceId: settingsEventsSourceId, event });
    channel.close();
  } catch {
    // ignore cross-tab sync failures
  }
}

function shouldHandleEvent(event: SettingsEventMessage, context: SettingsEventContext): boolean {
  if (event.scope === "company") return true;
  return event.user_id === context.userId;
}

function eventDedupeKey(event: SettingsEventMessage): string {
  return `${event.scope}:${event.namespace}:${event.user_id ?? 0}`;
}

function queueSettingsEvent(
  token: string,
  event: SettingsEventMessage,
  context: SettingsEventContext,
  handlers: SettingsEventHandlers,
): void {
  pendingSettingsEvents.set(eventDedupeKey(event), event);

  if (flushSettingsEventsTimer != null) return;

  flushSettingsEventsTimer = setTimeout(() => {
    flushSettingsEventsTimer = null;
    const events = [...pendingSettingsEvents.values()];
    pendingSettingsEvents.clear();
    void (async () => {
      for (const pendingEvent of events) {
        if (!shouldHandleEvent(pendingEvent, context)) continue;

        await refreshSettingsNamespace(token, pendingEvent.namespace, {
          companyId: context.companyId,
          userId: context.userId,
        }).catch(() => undefined);

        if (pendingEvent.scope === "company") {
          handlers.onCompanySettingsUpdated?.(pendingEvent.namespace);
          if (pendingEvent.namespace === "pos" || pendingEvent.namespace === "regos_defaults") {
            handlers.onEmployeeSettingsUpdated?.(pendingEvent.namespace);
          }
          continue;
        }

        handlers.onEmployeeSettingsUpdated?.(pendingEvent.namespace);
      }
    })().catch(() => undefined);
  }, SETTINGS_EVENT_DEBOUNCE_MS);
}

export function connectSettingsEvents(
  token: string,
  context: SettingsEventContext,
  handlers: SettingsEventHandlers,
): SettingsEventConnection {
  const baseUrl = getApiBaseUrl();
  const url = `${baseUrl}/api/v1/settings-events?access_token=${encodeURIComponent(token)}`;
  const source = new EventSource(url);

  const onMessage = (messageEvent: MessageEvent<string>) => {
    const event = parseSettingsEvent(messageEvent.data);
    if (!event) return;
    broadcastSettingsEvent(event);
    notifySettingsEventListeners(event);
    queueSettingsEvent(token, event, context, handlers);
  };

  source.addEventListener("message", onMessage as EventListener);

  let channel: BroadcastChannel | null = null;
  if (typeof BroadcastChannel !== "undefined") {
    channel = new BroadcastChannel(SETTINGS_EVENTS_CHANNEL);
    channel.onmessage = (message) => {
      const payload = message.data as { sourceId?: string; event?: SettingsEventMessage };
      if (payload?.sourceId === settingsEventsSourceId) return;
      const event = payload?.event;
      if (!event || event.type !== "settings_updated") return;
      notifySettingsEventListeners(event);
      queueSettingsEvent(token, event, context, handlers);
    };
  }

  return {
    close: () => {
      source.removeEventListener("message", onMessage as EventListener);
      source.close();
      channel?.close();
    },
  };
}
