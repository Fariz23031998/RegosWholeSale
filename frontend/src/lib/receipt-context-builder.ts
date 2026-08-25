import type { Sale, SalePaymentLine } from "@/data/seed";
import type { TranslateFn } from "@/lib/dashboard-api";
import {
  EMPTY_RECEIPT_OPERATION_ITEM,
  normalizeReceiptOperationItem,
  receiptOperationItemFromCatalogProduct,
} from "@/lib/receipt-operation-item";
import {
  buildOperationGroups,
  buildOperationTotals,
  lineAmount,
  lineDiscountAmount,
  lineGrossAmount,
} from "@/lib/receipt-operation-groups";
import {
  fetchWholesaleDocumentPayments,
  fetchWholesaleOperations,
  type CheckoutResponse,
  type WholesaleDocument,
  type WholesaleOperationLine,
  type WholesalePaymentLine,
  type WholesaleReturnDocument,
} from "@/lib/sales-api";
import type { CartItem, CartItemPrintMeta } from "@/store/cart";
import type { Product } from "@/types/catalog";
import type { PaymentType } from "@/types/payment";
import type { RegosCurrencyOption } from "@/types/settings";

import type { DocumentPrintContext, DocumentPrintKind } from "@/lib/receipt-print-context";

export type { DocumentPrintContext, DocumentPrintKind };

type SaleBuildOptions = {
  t?: TranslateFn;
  type?: Sale["type"];
  refundOf?: string;
  reason?: string;
};

function documentDateToIso(date: number): string {
  return date > 0 ? new Date(date * 1000).toISOString() : new Date().toISOString();
}

function buildSaleFromDocument(
  doc: WholesaleDocument | WholesaleReturnDocument,
  operations: WholesaleOperationLine[],
  payments: WholesalePaymentLine[],
  options: SaleBuildOptions = {},
): Sale {
  const { t, type, refundOf, reason } = options;
  const itemFallback = (id: number) =>
    t ? t("sales.itemFallback", undefined, { id }) : `Item #${id}`;
  const paymentFallback = t ? t("sales.paymentFallback") : "Payment";

  const items = operations.map((op) => ({
    productId: String(op.item_id),
    name: op.item_name ?? itemFallback(op.item_id),
    price: op.price,
    qty: op.quantity,
  }));
  const grossSubtotal = operations.reduce((sum, op) => sum + lineGrossAmount(op), 0);
  const netSubtotal = operations.reduce((sum, op) => sum + lineAmount(op), 0);
  const lineDiscount = operations.reduce((sum, op) => sum + lineDiscountAmount(op), 0);
  const total = doc.amount ?? netSubtotal;
  const extraDiscount = Math.max(0, +(netSubtotal - total).toFixed(2));
  const amountPaid = payments.reduce((sum, payment) => sum + (payment.amount ?? 0), 0);
  const paymentLines: SalePaymentLine[] = payments.map((payment, index) => ({
    paymentTypeId: payment.id || index + 1,
    paymentTypeName: payment.payment_type_name ?? paymentFallback,
    isCash: false,
    amountPaid: payment.amount ?? 0,
    paymentCurrency: payment.currency ?? null,
    paymentAmount: payment.amount ?? undefined,
  }));
  const primaryPayment = payments[0];

  return {
    id: doc.code || String(doc.id),
    createdAt: documentDateToIso(doc.date),
    cashierId: doc.attached_user_id ? String(doc.attached_user_id) : "",
    cashierName: doc.attached_user_name ?? doc.partner_name ?? "—",
    items,
    subtotal: +grossSubtotal.toFixed(2),
    discount: +(lineDiscount + extraDiscount).toFixed(2),
    tax: 0,
    total: +total.toFixed(2),
    paymentTypeId: 0,
    paymentTypeName:
      primaryPayment?.payment_type_name ??
      (payments.length === 0 ? "—" : paymentFallback),
    isCash: false,
    amountPaid: payments.length > 0 ? +amountPaid.toFixed(2) : undefined,
    balanceDue:
      payments.length > 0 ? +Math.max(total - amountPaid, 0).toFixed(2) : undefined,
    payments: paymentLines.length > 0 ? paymentLines : undefined,
    saleCurrency: doc.currency ?? null,
    type,
    refundOf,
    reason,
  };
}

function wrapDocumentContext(
  kind: DocumentPrintKind,
  document: WholesaleDocument | WholesaleReturnDocument,
  operations: WholesaleOperationLine[],
  payments: WholesalePaymentLine[],
  sale: Sale,
): DocumentPrintContext {
  const normalizedOperations = operations.map((operation) => withOperationItem(operation));
  const operation_groups = buildOperationGroups(normalizedOperations);
  const totals = buildOperationTotals(normalizedOperations);
  return {
    kind,
    document,
    operations: normalizedOperations,
    operation_groups,
    totals,
    payments,
    sale,
    partner_name: document.partner_name,
    stock_name: document.stock_name,
    document_code: document.code || String(document.id),
  };
}

export function buildPrintContextFromWholesale(
  doc: WholesaleDocument,
  operations: WholesaleOperationLine[],
  payments: WholesalePaymentLine[] = [],
  t?: TranslateFn,
): DocumentPrintContext {
  const sale = buildSaleFromDocument(doc, operations, payments, { t, type: "sale" });
  return wrapDocumentContext("sale", doc, operations, payments, sale);
}

export function buildPrintContextFromReturn(
  doc: WholesaleReturnDocument,
  operations: WholesaleOperationLine[],
  payments: WholesalePaymentLine[] = [],
  t?: TranslateFn,
): DocumentPrintContext {
  const sale = buildSaleFromDocument(doc, operations, payments, {
    t,
    type: "refund",
    refundOf: doc.wholesale_doc_id ? String(doc.wholesale_doc_id) : undefined,
    reason: doc.reason ?? undefined,
  });
  return wrapDocumentContext("return", doc, operations, payments, sale);
}

export type CheckoutCartLine = {
  regos_item_id: number;
  name: string;
  item_code?: string | null;
  item_group_id?: number | null;
  item_group_name?: string | null;
  item_unit_name?: string | null;
  item_brand?: string | null;
  item?: ReturnType<typeof receiptOperationItemFromCatalogProduct>;
};

function operationItemFromDetails(
  details?: Pick<CheckoutCartLine, "item"> | null,
  product?: Product | null,
) {
  return normalizeReceiptOperationItem(
    details?.item ?? receiptOperationItemFromCatalogProduct(product),
  );
}

function withOperationItem(
  line: WholesaleOperationLine,
  item = EMPTY_RECEIPT_OPERATION_ITEM,
): WholesaleOperationLine {
  return {
    ...line,
    item: normalizeReceiptOperationItem(line.item ?? item),
  };
}

export type CheckoutDocumentExtras = {
  partnerId?: number | null;
  partnerName?: string | null;
  partnerPhone?: string | null;
  stockId?: number | null;
  stockName?: string | null;
  saleCurrency?: RegosCurrencyOption | null;
  cashierId?: string | null;
  cashierName?: string | null;
};

function findCatalogProduct(
  catalogProducts: Product[],
  regosItemId: number,
  productId: string,
): Product | undefined {
  return catalogProducts.find(
    (entry) => entry.regos_item_id === regosItemId || entry.id === productId,
  );
}

type CartLineSource = Pick<
  CartItem,
  | "regosItemId"
  | "name"
  | "productId"
  | "itemCode"
  | "itemArticul"
  | "itemGroupId"
  | "itemGroupName"
  | "itemUnitName"
  | "itemBrand"
>;

function resolveCartLinePrintMeta(
  item: CartLineSource,
  product?: Product | null,
): Omit<CheckoutCartLine, "regos_item_id" | "name"> {
  const itemCode = item.itemCode?.trim() || product?.code?.trim() || null;
  const itemArticul = item.itemArticul?.trim() || product?.articul?.trim() || null;
  const itemGroupName = item.itemGroupName?.trim() || product?.category?.trim() || null;
  const itemUnitName = item.itemUnitName?.trim() || product?.unit_name?.trim() || null;

  const fromCatalog = receiptOperationItemFromCatalogProduct(product);
  const itemDetails = normalizeReceiptOperationItem({
    ...fromCatalog,
    fullname: item.name?.trim() || fromCatalog.fullname,
    articul: itemArticul || fromCatalog.articul,
    department: {
      name: itemGroupName || fromCatalog.department.name,
    },
  });

  return {
    item_code: itemCode,
    item_group_id: item.itemGroupId ?? product?.group_id ?? null,
    item_group_name: itemGroupName,
    item_unit_name: itemUnitName,
    item_brand: item.itemBrand?.trim() || null,
    item: itemDetails,
  };
}

export function buildCheckoutCartLines(
  cartItems: CartLineSource[],
  catalogProducts: Product[],
): CheckoutCartLine[] {
  return cartItems.map((item) => {
    const product = findCatalogProduct(catalogProducts, item.regosItemId, item.productId);
    const meta = resolveCartLinePrintMeta(item, product);

    return {
      regos_item_id: item.regosItemId,
      name: item.name,
      ...meta,
    };
  });
}

type CheckoutBuildInput = {
  result: CheckoutResponse;
  sale: Sale;
  cartLines?: CheckoutCartLine[];
  documentExtras?: CheckoutDocumentExtras;
  partnerName?: string | null;
  stockName?: string | null;
  saleCurrency?: RegosCurrencyOption | null;
};

function checkoutPaymentsToWholesaleLines(
  result: CheckoutResponse,
  paymentTypes: PaymentType[],
  paymentFallback: string,
): WholesalePaymentLine[] {
  const lines = result.payments ?? [result.payment];
  return lines.map((payment, index) => {
    const type = paymentTypes.find((entry) => entry.id === payment.payment_type_id);
    return {
      id: payment.payment_doc_id ?? index + 1,
      code: payment.payment_doc_id ? String(payment.payment_doc_id) : "",
      date: Math.floor(new Date(result.performed_at).getTime() / 1000),
      amount: payment.amount_paid,
      category_id: null,
      category_name: null,
      payment_type_name: type?.name ?? paymentFallback,
      partner_id: null,
      partner_name: null,
      attached_user_id: null,
      attached_user_name: null,
      exchange_rate: null,
      currency: payment.payment_currency ?? type?.currency ?? null,
    };
  });
}

function checkoutOperationsFromResult(
  result: CheckoutResponse,
  cartLines: CheckoutCartLine[] = [],
): WholesaleOperationLine[] {
  const detailsByItemId = new Map(cartLines.map((line) => [line.regos_item_id, line]));

  return result.lines.map((line, index) => {
    const details = detailsByItemId.get(line.regos_item_id);
    return withOperationItem({
      id: index + 1,
      document_id: result.wholesale_doc_id,
      item_id: line.regos_item_id,
      item_code: details?.item_code ?? null,
      item_name: details?.name ?? null,
      item_group_id: details?.item_group_id ?? null,
      item_group_name: details?.item_group_name ?? null,
      item_unit_name: details?.item_unit_name ?? null,
      item_brand: details?.item_brand ?? null,
      quantity: line.qty,
      price: line.price,
      price2: line.price2,
      amount: +(line.qty * line.price).toFixed(2),
    }, operationItemFromDetails(details));
  });
}

export function buildCheckoutWholesaleDocument(
  result: CheckoutResponse,
  extras: CheckoutDocumentExtras = {},
): WholesaleDocument {
  const cashierId = extras.cashierId ? Number(extras.cashierId) || null : null;

  return {
    id: result.wholesale_doc_id,
    code: result.wholesale_code,
    date: Math.floor(new Date(result.performed_at).getTime() / 1000),
    partner_id: extras.partnerId ?? null,
    partner_name: extras.partnerName ?? null,
    partner_phone: extras.partnerPhone ?? null,
    stock_id: extras.stockId ?? null,
    stock_name: extras.stockName ?? null,
    attached_user_id: cashierId,
    attached_user_name: extras.cashierName ?? null,
    amount: result.total,
    performed: true,
    currency: extras.saleCurrency ?? result.payment.sale_currency ?? null,
  };
}

function checkoutDocumentFromResult(
  result: CheckoutResponse,
  partnerName?: string | null,
  stockName?: string | null,
  saleCurrency?: RegosCurrencyOption | null,
): WholesaleDocument {
  return buildCheckoutWholesaleDocument(result, { partnerName, stockName, saleCurrency });
}

export type CartDraftPrintInput = {
  items: Array<
    Pick<CartItem, "regosItemId" | "name" | "productId" | "qty" | "price"> & CartItemPrintMeta
  >;
  totals: { subtotal: number; discount: number; total: number };
  catalogProducts: Product[];
  saleCurrency: RegosCurrencyOption | null;
  partnerId?: number | null;
  partnerName?: string | null;
  stockId?: number | null;
  stockName?: string | null;
  cashierId?: string | null;
  cashierName?: string | null;
  wholesaleDocId?: number | null;
};

function mergeCartItemsWithWholesaleOperations(
  items: CartDraftPrintInput["items"],
  operations: WholesaleOperationLine[],
  catalogProducts: Product[],
): WholesaleOperationLine[] {
  const operationsByItemId = new Map(operations.map((operation) => [operation.item_id, operation]));
  const cartLines = buildCheckoutCartLines(items, catalogProducts);
  const detailsByItemId = new Map(cartLines.map((line) => [line.regos_item_id, line]));

  return items.map((item, index) => {
    const fromApi = operationsByItemId.get(item.regosItemId);
    const details = detailsByItemId.get(item.regosItemId);
    const product = findCatalogProduct(catalogProducts, item.regosItemId, item.productId);

    if (fromApi) {
      return withOperationItem(
        {
          ...fromApi,
          id: index + 1,
          item_name: details?.name ?? fromApi.item_name ?? item.name,
          item_code: fromApi.item_code ?? details?.item_code ?? null,
          item_group_id: fromApi.item_group_id ?? details?.item_group_id ?? null,
          item_group_name: fromApi.item_group_name ?? details?.item_group_name ?? null,
          item_unit_name: fromApi.item_unit_name ?? details?.item_unit_name ?? null,
          item_brand: fromApi.item_brand ?? details?.item_brand ?? null,
          quantity: item.qty,
          price: item.price,
          price2: item.price,
          amount: +(item.qty * item.price).toFixed(2),
        },
        normalizeReceiptOperationItem(fromApi.item ?? details?.item),
      );
    }

    return withOperationItem(
      {
        id: index + 1,
        document_id: 0,
        item_id: item.regosItemId,
        item_code: details?.item_code ?? null,
        item_name: details?.name ?? item.name,
        item_group_id: details?.item_group_id ?? null,
        item_group_name: details?.item_group_name ?? null,
        item_unit_name: details?.item_unit_name ?? null,
        item_brand: details?.item_brand ?? null,
        quantity: item.qty,
        price: item.price,
        price2: item.price,
        amount: +(item.qty * item.price).toFixed(2),
      },
      operationItemFromDetails(details, product),
    );
  });
}

export function buildPrintContextFromCartDraft(
  input: CartDraftPrintInput,
): DocumentPrintContext {
  const cartLines = buildCheckoutCartLines(input.items, input.catalogProducts);
  const detailsByItemId = new Map(cartLines.map((line) => [line.regos_item_id, line]));
  const docId = input.wholesaleDocId ?? 0;
  const docCode = input.wholesaleDocId != null ? String(input.wholesaleDocId) : "";
  const cashierId = input.cashierId ? Number(input.cashierId) || null : null;

  const operations: WholesaleOperationLine[] = input.items.map((item, index) => {
    const details = detailsByItemId.get(item.regosItemId);
    const product = findCatalogProduct(
      input.catalogProducts,
      item.regosItemId,
      item.productId,
    );
    const meta = resolveCartLinePrintMeta(item, product);

    return withOperationItem(
      {
        id: index + 1,
        document_id: docId,
        item_id: item.regosItemId,
        item_code: meta.item_code,
        item_name: details?.name ?? item.name,
        item_group_id: meta.item_group_id,
        item_group_name: meta.item_group_name,
        item_unit_name: meta.item_unit_name,
        item_brand: meta.item_brand,
        quantity: item.qty,
        price: item.price,
        price2: item.price,
        amount: +(item.qty * item.price).toFixed(2),
      },
      operationItemFromDetails(details, product),
    );
  });

  const document: WholesaleDocument = {
    id: docId,
    code: docCode,
    date: Math.floor(Date.now() / 1000),
    partner_id: input.partnerId ?? null,
    partner_name: input.partnerName ?? null,
    stock_id: input.stockId ?? null,
    stock_name: input.stockName ?? null,
    attached_user_id: cashierId,
    attached_user_name: input.cashierName ?? null,
    amount: input.totals.total,
    performed: false,
    currency: input.saleCurrency ?? null,
  };

  const sale: Sale = {
    id: docCode || "—",
    createdAt: new Date().toISOString(),
    cashierId: input.cashierId ?? "",
    cashierName: input.cashierName ?? "—",
    items: input.items.map((item) => ({
      productId: item.productId,
      name: item.name,
      price: item.price,
      qty: item.qty,
    })),
    subtotal: input.totals.subtotal,
    discount: input.totals.discount,
    tax: 0,
    total: input.totals.total,
    paymentTypeId: 0,
    paymentTypeName: "—",
    isCash: false,
    saleCurrency: input.saleCurrency ?? null,
  };

  return wrapDocumentContext("sale", document, operations, [], sale);
}

export async function loadPrintContextFromCartDraft(
  token: string | null | undefined,
  input: CartDraftPrintInput,
): Promise<DocumentPrintContext> {
  if (token && input.wholesaleDocId != null && input.wholesaleDocId > 0) {
    try {
      const operationsRes = await fetchWholesaleOperations(token, input.wholesaleDocId);
      if (operationsRes.operations.length > 0) {
        const context = buildPrintContextFromCartDraft(input);
        const operations = mergeCartItemsWithWholesaleOperations(
          input.items,
          operationsRes.operations,
          input.catalogProducts,
        );
        return {
          ...context,
          operations,
          operation_groups: buildOperationGroups(operations),
          totals: buildOperationTotals(operations),
        };
      }
    } catch {
      // Fall back to cart metadata when postponed document lines are unavailable.
    }
  }

  return buildPrintContextFromCartDraft(input);
}

export function buildPrintContextFromCheckout(
  input: CheckoutBuildInput,
  paymentTypes: PaymentType[] = [],
  paymentFallback = "Payment",
): DocumentPrintContext {
  const {
    result,
    sale,
    cartLines = [],
    documentExtras,
    partnerName,
    stockName,
    saleCurrency,
  } = input;
  const document =
    documentExtras != null
      ? buildCheckoutWholesaleDocument(result, documentExtras)
      : checkoutDocumentFromResult(result, partnerName, stockName, saleCurrency);
  const operations = checkoutOperationsFromResult(result, cartLines);
  const payments = checkoutPaymentsToWholesaleLines(result, paymentTypes, paymentFallback);

  return wrapDocumentContext("sale", document, operations, payments, sale);
}

export async function loadPrintContextFromCheckout(
  token: string,
  input: CheckoutBuildInput,
  paymentTypes: PaymentType[] = [],
  paymentFallback = "Payment",
  t?: TranslateFn,
): Promise<DocumentPrintContext> {
  const document =
    input.documentExtras != null
      ? buildCheckoutWholesaleDocument(input.result, input.documentExtras)
      : checkoutDocumentFromResult(
          input.result,
          input.partnerName,
          input.stockName,
          input.saleCurrency,
        );

  try {
    const [operationsRes, paymentsRes] = await Promise.all([
      fetchWholesaleOperations(token, input.result.wholesale_doc_id),
      fetchWholesaleDocumentPayments(token, input.result.wholesale_doc_id),
    ]);

    if (operationsRes.operations.length > 0) {
      return buildPrintContextFromWholesale(
        document,
        operationsRes.operations,
        paymentsRes.payments,
        t,
      );
    }
  } catch {
    // Fall back to checkout payload and cart metadata when Regos data is not ready yet.
  }

  return buildPrintContextFromCheckout(input, paymentTypes, paymentFallback);
}
