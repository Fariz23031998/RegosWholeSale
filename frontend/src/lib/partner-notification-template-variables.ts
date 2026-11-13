import type { PartnerNotificationTemplateType } from "@/lib/partner-telegram-api";

export type PartnerNotificationVariableGroupId =
  | "shared"
  | "document"
  | "itemsLoop"
  | "payment"
  | "balance";

export type PartnerNotificationVariable = {
  /** Full placeholder expression shown in the docs UI. */
  expression: string;
  /** i18n key suffix under partnerTelegram.var.* */
  key: string;
  descriptionFallback: string;
};

export type PartnerNotificationVariableGroup = {
  id: PartnerNotificationVariableGroupId;
  labelKey: string;
  labelFallback: string;
  variables: PartnerNotificationVariable[];
};

const DOCUMENT_TYPES: PartnerNotificationTemplateType[] = [
  "purchase",
  "return_purchase",
  "wholesale",
  "wholesale_return",
];

function isDocumentType(type: PartnerNotificationTemplateType): boolean {
  return DOCUMENT_TYPES.includes(type);
}

const SHARED_GROUP: PartnerNotificationVariableGroup = {
  id: "shared",
  labelKey: "partnerTelegram.varGroup.shared",
  labelFallback: "Shared",
  variables: [
    {
      expression: "{{partner_id}}",
      key: "partner_id",
      descriptionFallback: "Partner ID",
    },
    {
      expression: "{{partner_name}}",
      key: "partner_name",
      descriptionFallback: "Partner name",
    },
  ],
};

const DOCUMENT_GROUP: PartnerNotificationVariableGroup = {
  id: "document",
  labelKey: "partnerTelegram.varGroup.document",
  labelFallback: "Document",
  variables: [
    {
      expression: "{{document_code}}",
      key: "document_code",
      descriptionFallback: "Document code",
    },
    {
      expression: "{{date}}",
      key: "date",
      descriptionFallback: "Document date",
    },
    {
      expression: "{{warehouse}}",
      key: "warehouse",
      descriptionFallback: "Warehouse name",
    },
    {
      expression: "{{currency}}",
      key: "currency",
      descriptionFallback: "Currency name",
    },
    {
      expression: "{{exchange_rate}}",
      key: "exchange_rate",
      descriptionFallback: "Exchange rate",
    },
    {
      expression: "{{items}}",
      key: "items",
      descriptionFallback: "Pre-formatted items block",
    },
    {
      expression: "{{total_items}}",
      key: "total_items",
      descriptionFallback: "Total quantity of items",
    },
    {
      expression: "{{total}}",
      key: "total",
      descriptionFallback: "Document total",
    },
    {
      expression: "{{cancelled}}",
      key: "cancelled",
      descriptionFallback: "Cancelled label when the document is cancelled",
    },
    {
      expression: "{{balance}}",
      key: "balance",
      descriptionFallback: "Partner balance for the document firm/currency",
    },
  ],
};

const ITEMS_LOOP_GROUP: PartnerNotificationVariableGroup = {
  id: "itemsLoop",
  labelKey: "partnerTelegram.varGroup.itemsLoop",
  labelFallback: "Item loop",
  variables: [
    {
      expression: "{{#items}}…{{/items}}",
      key: "items_loop",
      descriptionFallback: "Repeats the block once per line item",
    },
    {
      expression: "{{index}}",
      key: "index",
      descriptionFallback: "1-based line number (inside the loop)",
    },
    {
      expression: "{{name}}",
      key: "name",
      descriptionFallback: "Item name (inside the loop)",
    },
    {
      expression: "{{code}}",
      key: "code",
      descriptionFallback: "Item code (inside the loop)",
    },
    {
      expression: "{{articul}}",
      key: "articul",
      descriptionFallback: "Item articul (inside the loop)",
    },
    {
      expression: "{{barcode}}",
      key: "barcode",
      descriptionFallback: "Item barcode (inside the loop)",
    },
    {
      expression: "{{quantity}}",
      key: "quantity",
      descriptionFallback: "Line quantity (inside the loop)",
    },
    {
      expression: "{{price}}",
      key: "price",
      descriptionFallback: "Unit price or cost (inside the loop)",
    },
    {
      expression: "{{line_total}}",
      key: "line_total",
      descriptionFallback: "Line total (inside the loop)",
    },
    {
      expression: "{{description}}",
      key: "description",
      descriptionFallback: "Line description (inside the loop)",
    },
  ],
};

const PAYMENT_GROUP: PartnerNotificationVariableGroup = {
  id: "payment",
  labelKey: "partnerTelegram.varGroup.payment",
  labelFallback: "Payment",
  variables: [
    {
      expression: "{{document_code}}",
      key: "document_code",
      descriptionFallback: "Payment document code",
    },
    {
      expression: "{{date}}",
      key: "date",
      descriptionFallback: "Payment date",
    },
    {
      expression: "{{amount}}",
      key: "amount",
      descriptionFallback: "Payment amount",
    },
    {
      expression: "{{payment_type}}",
      key: "payment_type",
      descriptionFallback: "Payment type name",
    },
    {
      expression: "{{category}}",
      key: "category",
      descriptionFallback: "Payment category name",
    },
    {
      expression: "{{currency}}",
      key: "currency",
      descriptionFallback: "Currency name",
    },
    {
      expression: "{{direction}}",
      key: "direction",
      descriptionFallback: "Paid or received label",
    },
    {
      expression: "{{cancelled}}",
      key: "cancelled",
      descriptionFallback: "Cancelled label when the payment is cancelled",
    },
    {
      expression: "{{balance}}",
      key: "balance",
      descriptionFallback: "Partner balance after the payment",
    },
  ],
};

const BALANCE_GROUP: PartnerNotificationVariableGroup = {
  id: "balance",
  labelKey: "partnerTelegram.varGroup.balance",
  labelFallback: "Balance",
  variables: [
    {
      expression: "{{firm_name}}",
      key: "firm_name",
      descriptionFallback: "Firm name for this balance line",
    },
    {
      expression: "{{currency_name}}",
      key: "currency_name",
      descriptionFallback: "Currency name for this balance line",
    },
    {
      expression: "{{balance}}",
      key: "balance",
      descriptionFallback: "Balance amount for this firm/currency line",
    },
  ],
};

/** Groups of placeholders available for the given notification template type. */
export function getPartnerNotificationVariableGroups(
  type: PartnerNotificationTemplateType,
): PartnerNotificationVariableGroup[] {
  if (type === "balance") {
    return [SHARED_GROUP, BALANCE_GROUP];
  }
  if (type === "payment") {
    return [SHARED_GROUP, PAYMENT_GROUP];
  }
  if (isDocumentType(type)) {
    return [SHARED_GROUP, DOCUMENT_GROUP, ITEMS_LOOP_GROUP];
  }
  return [SHARED_GROUP];
}
