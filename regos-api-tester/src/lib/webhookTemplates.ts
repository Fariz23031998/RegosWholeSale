export type WebhookResourceKind = "id" | "uuid";

export type WebhookEventTemplate = {
  action: string;
  kind: WebhookResourceKind;
  group: "operation" | "payment" | "pos";
  label: string;
};

/** Mirrors EVENT_SPECS and POS_EVENT_SPECS from backend/app/services/regos_webhook.py */
export const WEBHOOK_EVENT_TEMPLATES: WebhookEventTemplate[] = [
  { action: "DocPurchasePerformed", kind: "id", group: "operation", label: "Purchase performed" },
  {
    action: "DocPurchasePerformCanceled",
    kind: "id",
    group: "operation",
    label: "Purchase cancelled",
  },
  {
    action: "DocReturnsToPartnerPerformed",
    kind: "id",
    group: "operation",
    label: "Return to partner performed",
  },
  {
    action: "DocReturnsToPartnerPerformCanceled",
    kind: "id",
    group: "operation",
    label: "Return to partner cancelled",
  },
  {
    action: "DocWholeSalePerformed",
    kind: "id",
    group: "operation",
    label: "Wholesale performed",
  },
  {
    action: "DocWholeSalePerformCanceled",
    kind: "id",
    group: "operation",
    label: "Wholesale cancelled",
  },
  {
    action: "DocWholeSaleReturnPerformed",
    kind: "id",
    group: "operation",
    label: "Wholesale return performed",
  },
  {
    action: "DocWholeSaleReturnPerformCanceled",
    kind: "id",
    group: "operation",
    label: "Wholesale return cancelled",
  },
  { action: "DocPaymentPerformed", kind: "id", group: "payment", label: "Payment performed" },
  {
    action: "DocPaymentPerformCanceled",
    kind: "id",
    group: "payment",
    label: "Payment cancelled",
  },
  { action: "DocInOutPerformed", kind: "id", group: "operation", label: "In/Out performed" },
  {
    action: "DocInOutPerformCanceled",
    kind: "id",
    group: "operation",
    label: "In/Out cancelled",
  },
  {
    action: "DocMovementPerformed",
    kind: "id",
    group: "operation",
    label: "Movement performed",
  },
  {
    action: "DocMovementPerformCanceled",
    kind: "id",
    group: "operation",
    label: "Movement cancelled",
  },
  { action: "DocChequeClosed", kind: "uuid", group: "pos", label: "POS cheque closed" },
  { action: "DocChequeCanceled", kind: "uuid", group: "pos", label: "POS cheque canceled" },
  { action: "POSChequePayDebt", kind: "uuid", group: "pos", label: "POS cheque pay debt" },
  { action: "DocSessionOpened", kind: "uuid", group: "pos", label: "POS session opened" },
  { action: "DocSessionClosed", kind: "uuid", group: "pos", label: "POS session closed" },
];

export type WebhookTemplateParams = {
  eventId: string;
  connectedIntegrationId: string;
  documentId: string;
  resourceUuid: string;
};

export function buildWebhookPayload(
  template: WebhookEventTemplate,
  params: WebhookTemplateParams,
): Record<string, unknown> {
  const data =
    template.kind === "uuid"
      ? { uuid: params.resourceUuid }
      : { id: Number.isFinite(Number(params.documentId)) ? Number(params.documentId) : params.documentId };

  return {
    action: "HandleWebhook",
    event_id: params.eventId,
    connected_integration_id: params.connectedIntegrationId,
    data: {
      action: template.action,
      data,
    },
  };
}

export function buildWebhookPayloadJson(
  template: WebhookEventTemplate,
  params: WebhookTemplateParams,
): string {
  return JSON.stringify(buildWebhookPayload(template, params), null, 2);
}
